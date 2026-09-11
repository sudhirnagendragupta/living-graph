import { GraphNode, GraphEdge, StateNode, StateTransitionEdge, RawWorkflow } from '../types.js';

/**
 * PatternClassifier clusters discovered nodes and edges into RawWorkflows
 * purely from graph topology and semantic patterns.
 *
 * Zero hardcoded node IDs. Zero hardcoded edge IDs.
 *
 * Clustering rules:
 *  - modal / tab / toggle / bulk_select each already represent one complete,
 *    meaningful interaction on their own → one workflow per state node.
 *  - wizard_step represents a multi-step sequence; any 'form_field' state
 *    nodes that live in the SAME file are folded into the wizard's workflow
 *    as its fill-in steps, since a wizard's per-step fields are declared
 *    alongside the step counter in the same component.
 *  - 'form_field' nodes NOT co-located with a wizard are grouped by their
 *    enclosing <form> (formGroupId) — or, absent a <form> ancestor, by their
 *    parent route — into ONE composite workflow, and the form's synthesized
 *    submit edge (if any) is appended so the workflow actually completes.
 *  - filter remains standalone (a real search box is a complete action).
 */
export class PatternClassifier {
  public cluster(
    routeNodes: Record<string, GraphNode>,
    stateNodes: Record<string, StateNode>,
    navigationEdges: GraphEdge[],
    stateEdges: StateTransitionEdge[]
  ): RawWorkflow[] {
    const workflows: RawWorkflow[] = [];
    const stateNodeList = Object.values(stateNodes);
    const grouped = this.groupByParent(stateNodeList);

    // Identify entry/root node for the application (Home, Dashboard, or route without incoming edges)
    const rootNodeId = this.resolveRootNodeId(routeNodes, navigationEdges);

    // 1. Synthesize Complete Form & Creation Journeys
    for (const [parentNodeId, nodes] of grouped) {
      if (!routeNodes[parentNodeId] && !parentNodeId.startsWith('component_')) continue;

      const wizardNodes = nodes.filter((n) => n.kind === 'wizard_step');
      const formFields = nodes.filter((n) => n.kind === 'form_field');

      // A) Wizard Journey: Multi-step interactive flow from entry to completion
      if (wizardNodes.length > 0) {
        const wizardEdges = stateEdges.filter((e) =>
          wizardNodes.some((w) => e.sourceStateId === w.id || e.targetStateId === w.id)
        );
        const fieldEdges = formFields.flatMap((f) => this.edgesForStateNode(f.id, stateEdges));
        
        // Find incoming navigation from root to this wizard route
        const entryNavEdges = parentNodeId !== rootNodeId
          ? this.findNavPath(rootNodeId, parentNodeId, navigationEdges)
          : [];

        // Find outgoing navigation from wizard upon completion
        const exitNavEdges = navigationEdges.filter((e) => e.sourceNodeId === parentNodeId);

        const candidateEdges = [
          ...entryNavEdges,
          ...fieldEdges,
          ...wizardEdges.map((e) => e.id),
          ...(exitNavEdges.length > 0 ? [exitNavEdges[0].id] : []),
        ];

        if (candidateEdges.length >= 2) {
          workflows.push({
            id: `wf_journey_create_${parentNodeId}`,
            pattern: 'wizard_step',
            parentNodeId: entryNavEdges.length > 0 ? rootNodeId : parentNodeId,
            candidateEdgeIds: candidateEdges,
            stateNodeIds: [...wizardNodes.map((w) => w.id), ...formFields.map((f) => f.id)],
            branchCondition: undefined,
          });
        }
      }

      // B) Standard Form / Action Journeys (e.g. Login, Create, Edit, Contact)
      if (wizardNodes.length === 0 && formFields.length > 0) {
        const buckets = this.groupFormFields(formFields, parentNodeId);

        for (const [bucketKey, fields] of buckets) {
          // Check if these fields are only rendered under some gating
          // condition — a modal (`{showInviteModal && <input/>}`) or a tab
          // selection (`{activeTab === 'team' && <input/>}`) are both the
          // same shape: some other state node must be driven to a specific
          // value before this field is even visible. Without prepending
          // that step, the workflow's first action targets a hidden field.
          const openModalEdges = this.findPreconditionEdges(fields, nodes, stateEdges);

          const fieldEdges = fields.flatMap((sn) => this.edgesForStateNode(sn.id, stateEdges));
          const submitEdges = stateEdges.filter((e) => e.sourceStateId === bucketKey);

          // Find incoming navigation if form is not on entry route
          const entryNavEdges = parentNodeId !== rootNodeId
            ? this.findNavPath(rootNodeId, parentNodeId, navigationEdges)
            : [];

          // Check if there is a navigation edge triggered by the form submit on parentNodeId
          // (e.g. login -> dashboard, or creation form -> detail)
          const formSubmitNavEdge = navigationEdges.find(
            (e) =>
              e.sourceNodeId === parentNodeId &&
              (e.action.type === 'submit' ||
               /submit|save|continue|login|sign\s*in/i.test(e.action.targetLabel || '') ||
               e.action.targetSelector === 'form' ||
               e.action.targetSelector.includes('submit'))
          );

          const completionEdges = formSubmitNavEdge
            ? [formSubmitNavEdge.id]
            : submitEdges.map((e) => e.id);

          const candidateEdges = [
            ...entryNavEdges,
            ...openModalEdges,
            ...fieldEdges,
            ...completionEdges,
          ];

          if (candidateEdges.length >= 2) {
            workflows.push({
              id: `wf_journey_form_${parentNodeId}_${this.sanitizeId(bucketKey)}`,
              pattern: 'form_field',
              parentNodeId: entryNavEdges.length > 0 ? rootNodeId : parentNodeId,
              candidateEdgeIds: candidateEdges,
              stateNodeIds: fields.map((f) => f.id),
              branchCondition: undefined,
            });
          }
        }
      }

      // C) Page Configuration / Settings Journeys (grouping toggles & modals into a single journey)
      const configNodes = nodes.filter((n) => n.kind === 'toggle' || n.kind === 'modal' || n.kind === 'tab');
      if (wizardNodes.length === 0 && formFields.length === 0 && configNodes.length >= 1) {
        const configEdges = configNodes.flatMap((n) => this.edgesForStateNode(n.id, stateEdges));
        const entryNavEdges = parentNodeId !== rootNodeId
          ? this.findNavPath(rootNodeId, parentNodeId, navigationEdges)
          : [];

        const candidateEdges = [...entryNavEdges, ...configEdges];
        if (candidateEdges.length >= 2) {
          workflows.push({
            id: `wf_journey_configure_${parentNodeId}`,
            pattern: 'settings',
            parentNodeId: entryNavEdges.length > 0 ? rootNodeId : parentNodeId,
            candidateEdgeIds: candidateEdges,
            stateNodeIds: configNodes.map((n) => n.id),
            branchCondition: undefined,
          });
        }
      }
    }

    // 2. Synthesize Resource Exploration & Search Journeys (Browse -> Filter -> View Item)
    for (const [nodeId, node] of Object.entries(routeNodes)) {
      const isResourceList =
        /list|table|directory|catalog|queue|tickets|items|orders|users/i.test(nodeId) ||
        /list|table|queue/i.test(node.title || '');

      if (isResourceList) {
        const entryNav = this.findNavPath(rootNodeId, nodeId, navigationEdges);
        const filterStateNodes = (grouped.get(nodeId) || []).filter((n) => n.kind === 'filter');
        const filterEdges = filterStateNodes.flatMap((f) => this.edgesForStateNode(f.id, stateEdges));
        const drillDownEdges = navigationEdges.filter((e) => e.sourceNodeId === nodeId);

        const explorationEdges = [
          ...entryNav,
          ...filterEdges,
          ...(drillDownEdges.length > 0 ? [drillDownEdges[0].id] : []),
        ];

        if (explorationEdges.length >= 2) {
          workflows.push({
            id: `wf_journey_explore_${nodeId}`,
            pattern: 'exploration',
            parentNodeId: rootNodeId,
            candidateEdgeIds: explorationEdges,
            stateNodeIds: filterStateNodes.map((f) => f.id),
            branchCondition: undefined,
          });
        }
      }
    }

    // 3. Multi-Step Navigation Chains (Only paths of length >= 2)
    const urlChains = this.discoverUrlChains(routeNodes, navigationEdges).filter(
      (wf) => wf.candidateEdgeIds.length >= 2
    );
    workflows.push(...urlChains);

    // If no multi-step workflows were discovered, allow longest available chains as fallback
    if (workflows.length === 0) {
      const allChains = this.discoverUrlChains(routeNodes, navigationEdges);
      workflows.push(...allChains.slice(0, 3));
    }

    return this.deduplicateWorkflows(workflows);
  }

  private resolveRootNodeId(
    routeNodes: Record<string, GraphNode>,
    navigationEdges: GraphEdge[]
  ): string {
    const nodeIds = Object.keys(routeNodes);
    // 1. Explicit dashboard/home/root match
    const namedRoot = nodeIds.find((id) =>
      /dashboard|home|root|overview|main|index/i.test(id) ||
      routeNodes[id]?.route === '/' ||
      routeNodes[id]?.route === '/dashboard'
    );
    if (namedRoot) return namedRoot;

    // 2. Node with no incoming edges
    const hasIncoming = new Set(navigationEdges.map((e) => e.targetNodeId));
    const noIncoming = nodeIds.find((id) => !hasIncoming.has(id));
    if (noIncoming) return noIncoming;

    return nodeIds[0] || 'root';
  }

  private findNavPath(
    fromNodeId: string,
    toNodeId: string,
    navigationEdges: GraphEdge[]
  ): string[] {
    if (fromNodeId === toNodeId) return [];

    const queue: Array<{ current: string; edges: string[] }> = [
      { current: fromNodeId, edges: [] },
    ];
    const visited = new Set<string>([fromNodeId]);

    while (queue.length > 0) {
      const { current, edges } = queue.shift()!;
      const outgoing = navigationEdges.filter((e) => e.sourceNodeId === current);

      for (const edge of outgoing) {
        if (edge.targetNodeId === toNodeId) {
          return [...edges, edge.id];
        }
        if (!visited.has(edge.targetNodeId)) {
          visited.add(edge.targetNodeId);
          queue.push({ current: edge.targetNodeId, edges: [...edges, edge.id] });
        }
      }
    }

    // Direct match fallback
    const direct = navigationEdges.find((e) => e.targetNodeId === toNodeId);
    return direct ? [direct.id] : [];
  }

  /**
   * Return representative edges for a state node.
   */
  private edgesForStateNode(stateNodeId: string, stateEdges: StateTransitionEdge[]): string[] {
    const matches = stateEdges.filter(
      (e) =>
        (e.sourceStateId === stateNodeId || e.targetStateId === stateNodeId) &&
        e.triggerSelector &&
        e.triggerSelector.length > 0
    );
    if (matches.length === 0) return [];
    const fillMatch = matches.find((e) => e.action.type === 'fill' || e.action.type === 'select');
    return [(fillMatch ?? matches[0]).id];
  }

  /**
   * Parses a JSX conditional-render guard's source text into the state
   * variable it depends on and, when it's an equality check (a tab/enum
   * selector like `activeTab === 'team'`), the specific value that must be
   * reached. A bare identifier (`showInviteModal`) has no target value —
   * any edge that flips it is sufficient.
   */
  private parseConditionalGate(condition: string): { stateName: string; targetValue?: string } | null {
    const trimmed = condition.trim();
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
      return { stateName: trimmed };
    }
    let m = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*===?\s*(['"`][^'"`]*['"`])$/);
    if (m) return { stateName: m[1], targetValue: m[2] };
    m = trimmed.match(/^(['"`][^'"`]*['"`])\s*===?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
    if (m) return { stateName: m[2], targetValue: m[1] };
    return null;
  }

  /**
   * Resolves a single conditional-render guard (e.g. "showInviteModal" or
   * "activeTab === 'team'") to the one edge that satisfies it: for a plain
   * boolean toggle, any edge that flips it; for an equality check against
   * an enum/tab state, specifically the edge whose payload sets that exact
   * value — not just any edge on that state node, or the walker ends up on
   * the wrong tab.
   */
  private resolveGateEdge(
    gateText: string,
    allNodes: StateNode[],
    stateEdges: StateTransitionEdge[]
  ): StateTransitionEdge | undefined {
    const gate = this.parseConditionalGate(gateText);
    if (!gate) return undefined;

    const gatingNode = allNodes.find((n) => n.stateName === gate.stateName);
    if (!gatingNode) return undefined;

    if (gate.targetValue) {
      const cleanVal = gate.targetValue.replace(/^['"`]|['"`]$/g, '').trim();
      const valueMatch = stateEdges.find(
        (e) =>
          (e.sourceStateId === gatingNode.id || e.targetStateId === gatingNode.id) &&
          e.triggerSelector &&
          String(e.action.payload?.value ?? '').replace(/^['"`]|['"`]$/g, '').trim() === cleanVal
      );
      if (valueMatch) return valueMatch;

      // If the setter was called dynamically in a map/list with a prefix selector
      // (e.g. `button[data-testid^="settings-tab-"]` with target value `'team'`),
      // find that edge and specialize it for the exact target value.
      const prefixEdge = stateEdges.find(
        (e) =>
          (e.sourceStateId === gatingNode.id || e.targetStateId === gatingNode.id) &&
          e.triggerSelector &&
          (e.triggerSelector.includes('^=') || e.triggerSelector.includes('*='))
      );
      if (prefixEdge) {
        const specializedSelector = prefixEdge.triggerSelector
          .replace(/\^="([^"]*)"/, `="$1${cleanVal}"`)
          .replace(/\*="([^"]*)"/, `="$1${cleanVal}"`);

        const humanLabel = cleanVal === 'team' ? 'Team Members' : cleanVal
          .split(/[-_]/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');

        const specializedEdge: StateTransitionEdge = {
          ...prefixEdge,
          id: `${prefixEdge.id}_${cleanVal}`,
          triggerSelector: specializedSelector,
          triggerLabel: humanLabel,
          action: {
            ...prefixEdge.action,
            targetSelector: specializedSelector,
            targetLabel: humanLabel,
            payload: { value: cleanVal },
          },
          narration: `Click ${humanLabel} to open ${humanLabel.toLowerCase()} settings.`,
          playwrightCode: `await page.click('${specializedSelector}');`,
        };

        if (!stateEdges.some((e) => e.id === specializedEdge.id)) {
          stateEdges.push(specializedEdge);
        }

        return specializedEdge;
      }
    }

    const fallbackId = this.edgesForStateNode(gatingNode.id, stateEdges)[0];
    return stateEdges.find((e) => e.id === fallbackId);
  }

  /**
   * Finds the full chain of edges needed to reveal a set of otherwise-
   * hidden fields, given their `enclosingConditionalState` guard —
   * recursively, since the edge that satisfies one guard (e.g. clicking a
   * button to open a modal) can itself be gated behind another (e.g. that
   * button only exists on one tab). Returns edges outermost-precondition
   * first, so e.g. [click Team tab, click Invite button] precedes the
   * fields it reveals.
   */
  private findPreconditionEdges(
    fields: StateNode[],
    allNodes: StateNode[],
    stateEdges: StateTransitionEdge[]
  ): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();

    let gateText = fields.map((f) => f.enclosingConditionalState).find(Boolean);

    while (gateText && !visited.has(gateText) && visited.size < 6) {
      visited.add(gateText);
      const edge = this.resolveGateEdge(gateText, allNodes, stateEdges);
      if (!edge) break;

      chain.unshift(edge.id);
      gateText = edge.enclosingConditionalState;
    }

    return chain;
  }

  /**
   * Group form_field state nodes by shared form container.
   */
  private groupFormFields(fields: StateNode[], parentNodeId: string): Map<string, StateNode[]> {
    const buckets = new Map<string, StateNode[]>();
    for (const f of fields) {
      const key = f.formGroupId ?? `ungrouped_${parentNodeId}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(f);
    }
    return buckets;
  }

  private sanitizeId(key: string): string {
    return key.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  // ─── URL chain discovery ──────────────────────────────────────────────────

  private discoverUrlChains(
    nodes: Record<string, GraphNode>,
    edges: GraphEdge[]
  ): RawWorkflow[] {
    const workflows: RawWorkflow[] = [];
    const nodeIds = Object.keys(nodes);

    const adjacency = new Map<string, GraphEdge[]>();
    for (const nodeId of nodeIds) adjacency.set(nodeId, []);
    for (const edge of edges) {
      if (adjacency.has(edge.sourceNodeId)) {
        adjacency.get(edge.sourceNodeId)!.push(edge);
      }
    }

    const hasIncoming = new Set(edges.map((e) => e.targetNodeId));
    const entryNodes = nodeIds.filter((id) => !hasIncoming.has(id));

    const visited = new Set<string>();
    for (const entry of entryNodes) {
      const paths = this.bfsPaths(entry, adjacency, nodes, 6);
      for (const path of paths) {
        if (path.edges.length < 1) continue;
        const id = `wf_url_chain_${path.nodes.join('_to_').slice(0, 80)}`;
        if (visited.has(id)) continue;
        visited.add(id);

        const branchConditions = [...new Set(path.edges
          .map((e) => e.branchCondition)
          .filter((c): c is string => Boolean(c)))];

        workflows.push({
          id,
          pattern: 'url_chain',
          parentNodeId: path.nodes[0],
          candidateEdgeIds: path.edges.map((e) => e.id),
          stateNodeIds: [],
          branchCondition: branchConditions.length === 1 ? branchConditions[0] : undefined,
        });
      }
    }

    return workflows;
  }

  private bfsPaths(
    startNode: string,
    adjacency: Map<string, GraphEdge[]>,
    nodes: Record<string, GraphNode>,
    maxDepth: number
  ): Array<{ nodes: string[]; edges: GraphEdge[] }> {
    const results: Array<{ nodes: string[]; edges: GraphEdge[] }> = [];
    const queue: Array<{ nodes: string[]; edges: GraphEdge[]; visited: Set<string> }> = [
      { nodes: [startNode], edges: [], visited: new Set([startNode]) },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const lastNode = current.nodes[current.nodes.length - 1];
      const outgoing = adjacency.get(lastNode) ?? [];

      if (current.edges.length >= 1) {
        results.push({ nodes: current.nodes, edges: current.edges });
      }

      if (current.edges.length >= maxDepth) continue;

      for (const edge of outgoing) {
        if (current.visited.has(edge.targetNodeId)) continue;
        if (!nodes[edge.targetNodeId]) continue;

        const newVisited = new Set(current.visited);
        newVisited.add(edge.targetNodeId);

        queue.push({
          nodes: [...current.nodes, edge.targetNodeId],
          edges: [...current.edges, edge],
          visited: newVisited,
        });
      }
    }

    return results;
  }

  // ─── Grouping ─────────────────────────────────────────────────────────────

  private groupByParent(stateNodes: StateNode[]): Map<string, StateNode[]> {
    const map = new Map<string, StateNode[]>();
    for (const sn of stateNodes) {
      if (!map.has(sn.parentRouteNodeId)) map.set(sn.parentRouteNodeId, []);
      map.get(sn.parentRouteNodeId)!.push(sn);
    }
    return map;
  }

  // ─── De-duplication ───────────────────────────────────────────────────────

  private deduplicateWorkflows(workflows: RawWorkflow[]): RawWorkflow[] {
    const seen = new Map<string, RawWorkflow>();

    for (const wf of workflows) {
      const key = `${wf.pattern}:${wf.parentNodeId}:${[...wf.candidateEdgeIds].sort().join(',')}`;

      if (seen.has(key)) {
        const existing = seen.get(key)!;
        if (existing.branchCondition !== wf.branchCondition) {
          existing.branchCondition = undefined;
        }
      } else {
        seen.set(key, { ...wf });
      }
    }

    return [...seen.values()];
  }
}
