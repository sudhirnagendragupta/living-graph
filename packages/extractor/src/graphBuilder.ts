import { WorkflowGraph, GraphDiff, WorkflowDiff } from './types.js';
import { CodebaseScanner } from './codebaseScanner.js';

export class GraphBuilder {
  private scanner: CodebaseScanner;

  constructor(sourceDir?: string) {
    this.scanner = new CodebaseScanner(sourceDir);
  }

  /**
   * Build complete workflow graph for the current codebase state.
   * One graph per run — no version concept.
   */
  public async buildGraph(): Promise<WorkflowGraph> {
    const graph = await this.scanner.scanGraph();
    this.validateGraph(graph);
    return graph;
  }

  /**
   * Compute structural diff between two graph runs.
   * Produces topic status: new / changed / stable / removed.
   * This is what the Cloud uses to classify topics on bundle upload.
   */
  public computeDiff(previousGraph: WorkflowGraph, currentGraph: WorkflowGraph): GraphDiff {
    const prevNodeIds = new Set(Object.keys(previousGraph.nodes));
    const currNodeIds = new Set(Object.keys(currentGraph.nodes));

    const prevStateNodeIds = new Set(Object.keys(previousGraph.stateNodes ?? {}));
    const currStateNodeIds = new Set(Object.keys(currentGraph.stateNodes ?? {}));

    const addedNodes = [...currNodeIds].filter((id) => !prevNodeIds.has(id));
    const removedNodes = [...prevNodeIds].filter((id) => !currNodeIds.has(id));

    const addedStateNodes = [...currStateNodeIds].filter((id) => !prevStateNodeIds.has(id));
    const removedStateNodes = [...prevStateNodeIds].filter((id) => !currStateNodeIds.has(id));

    const prevEdgeMap = new Map(previousGraph.edges.map((e) => [e.id, e]));
    const currEdgeMap = new Map(currentGraph.edges.map((e) => [e.id, e]));

    // Compute per-workflow status
    const workflowDiffs: WorkflowDiff[] = [];

    const prevWorkflowMap = new Map(previousGraph.workflows.map((w) => [w.id, w]));
    const currWorkflowMap = new Map(currentGraph.workflows.map((w) => [w.id, w]));

    // New workflows (exist in current, not in previous)
    for (const [id, wf] of currWorkflowMap) {
      if (!prevWorkflowMap.has(id)) {
        workflowDiffs.push({
          workflowId: id,
          title: wf.title,
          status: 'new',
          changedEdges: [],
          addedEdges: wf.steps.map((s) => s.edgeId),
          removedEdges: [],
        });
      }
    }

    // Removed workflows (exist in previous, not in current)
    for (const [id, wf] of prevWorkflowMap) {
      if (!currWorkflowMap.has(id)) {
        workflowDiffs.push({
          workflowId: id,
          title: wf.title,
          status: 'removed',
          changedEdges: [],
          addedEdges: [],
          removedEdges: wf.steps.map((s) => s.edgeId),
          driftReason: 'Workflow no longer detected in codebase.',
        });
      }
    }

    // Changed / stable workflows
    for (const [id, prevWf] of prevWorkflowMap) {
      const currWf = currWorkflowMap.get(id);
      if (!currWf) continue; // already handled as removed

      const prevEdgeIds = new Set(prevWf.steps.map((s) => s.edgeId));
      const currEdgeIds = new Set(currWf.steps.map((s) => s.edgeId));

      const addedEdges = [...currEdgeIds].filter((e) => !prevEdgeIds.has(e));
      const removedEdges = [...prevEdgeIds].filter((e) => !currEdgeIds.has(e));

      // Check if existing edges changed selectors
      const changedEdges: string[] = [];
      for (const edgeId of prevEdgeIds) {
        if (!currEdgeIds.has(edgeId)) continue;
        const prevEdge = prevEdgeMap.get(edgeId);
        const currEdge = currEdgeMap.get(edgeId);
        if (prevEdge && currEdge &&
          prevEdge.action.targetSelector !== currEdge.action.targetSelector) {
          changedEdges.push(edgeId);
        }
      }

      const hasChanges = addedEdges.length > 0 || removedEdges.length > 0 || changedEdges.length > 0;

      workflowDiffs.push({
        workflowId: id,
        title: currWf.title,
        status: hasChanges ? 'changed' : 'stable',
        changedEdges,
        addedEdges,
        removedEdges,
        driftReason: hasChanges
          ? this.describeDrift(addedEdges, removedEdges, changedEdges)
          : undefined,
      });
    }

    const brokenEdges = previousGraph.edges.filter((e) => !currEdgeMap.has(e.id));
    const newlyAddedEdges = currentGraph.edges.filter((e) => !prevEdgeMap.has(e.id));
    const hasAnyChange = workflowDiffs.some((w) => w.status !== 'stable') || brokenEdges.length > 0 || newlyAddedEdges.length > 0;

    const affectedWorkflows = workflowDiffs
      .filter((w) => w.status === 'changed' || w.status === 'removed')
      .map((w) => {
        const prev = prevWorkflowMap.get(w.workflowId);
        const curr = currWorkflowMap.get(w.workflowId);
        return {
          workflowId: w.workflowId,
          title: w.title,
          driftReason: w.driftReason,
          v1Path: prev ? (prev.edgeIds || prev.steps.map((s) => s.edgeId)) : [],
          v2Path: curr ? (curr.edgeIds || curr.steps.map((s) => s.edgeId)) : [],
        };
      });

    return {
      previousGeneratedAt: previousGraph.generatedAt,
      currentGeneratedAt: currentGraph.generatedAt,
      addedNodes,
      removedNodes,
      addedStateNodes,
      removedStateNodes,
      brokenEdges,
      addedEdges: newlyAddedEdges,
      driftDetected: hasAnyChange,
      affectedWorkflows,
      workflowDiffs,
      hasChanges: hasAnyChange,
    };
  }

  private describeDrift(added: string[], removed: string[], changed: string[]): string {
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} new step(s) added`);
    if (removed.length > 0) parts.push(`${removed.length} step(s) removed`);
    if (changed.length > 0) parts.push(`${changed.length} selector(s) changed`);
    return parts.join(', ') + '.';
  }

  private validateGraph(graph: WorkflowGraph): void {
    const nodeIds = new Set([
      ...Object.keys(graph.nodes),
      ...Object.keys(graph.stateNodes ?? {}),
    ]);

    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.sourceNodeId) && !edge.sourceNodeId.startsWith('component_')) {
        console.warn(`[GraphBuilder] Warning: edge ${edge.id} source ${edge.sourceNodeId} not in node set`);
      }
    }

    for (const wf of graph.workflows) {
      if (wf.steps.length === 0) {
        console.warn(`[GraphBuilder] Warning: workflow ${wf.id} has no steps`);
      }
    }
  }
}
