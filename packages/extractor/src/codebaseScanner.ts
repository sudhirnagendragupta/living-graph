import * as fs from 'fs';
import * as path from 'path';
import {
  GraphNode,
  GraphEdge,
  StateNode,
  StateTransitionEdge,
  EnrichedWorkflow,
  WorkflowGraph,
} from './types.js';
import { RouterScanner } from './ast/routerScanner.js';
import { ComponentScanner } from './ast/componentScanner.js';
import { StateScanner } from './ast/stateScanner.js';
import { EventTracer } from './ast/eventTracer.js';
import { WorkflowSynthesizer } from './ast/workflowSynthesizer.js';
import { LLMEnricher } from './llm/llmEnricher.js';

export interface ScanOptions {
  sourceDir?: string;
}

/**
 * CodebaseScanner: the top-level pipeline orchestrator.
 *
 * Pipeline:
 *   RouterScanner        → URL route nodes
 *   ComponentScanner     → interactive elements per route
 *   StateScanner         → intra-page state nodes + transition edges
 *   EventTracer          → URL navigation edges (unified with state edges)
 *   WorkflowSynthesizer  → raw workflow clusters (via PatternClassifier)
 *   LLMEnricher          → enriched workflows with titles, narrations, persona
 *
 * Produces one WorkflowGraph per run. No version field.
 * Diff between two graphs is handled externally (GraphBuilder.computeDiff).
 */
export class CodebaseScanner {
  private routerScanner: RouterScanner;
  private componentScanner: ComponentScanner;
  private stateScanner: StateScanner;
  private eventTracer: EventTracer;
  private workflowSynthesizer: WorkflowSynthesizer;
  private llmEnricher: LLMEnricher;
  private sourceDir: string;

  constructor(sourceDir?: string) {
    this.sourceDir = this.resolveSourceDir(sourceDir);
    this.routerScanner = new RouterScanner(this.sourceDir);
    this.componentScanner = new ComponentScanner();
    this.stateScanner = new StateScanner();
    this.eventTracer = new EventTracer();
    this.workflowSynthesizer = new WorkflowSynthesizer();
    this.llmEnricher = new LLMEnricher();
  }

  /**
   * Full scan pipeline. Returns a complete WorkflowGraph.
   * This is async because LLMEnricher makes network calls.
   */
  public async scanGraph(): Promise<WorkflowGraph> {
    console.log(`[CodebaseScanner] Scanning: ${this.sourceDir}`);

    // Step 1: Discover URL routes
    const routes = this.routerScanner.scanRoutes();
    console.log(`[CodebaseScanner] Routes discovered: ${routes.length}`);

    // Step 2: Build route nodes + enrich with interactive elements
    const routeNodes = this.routerScanner.routesToNodes(routes);
    for (const route of routes) {
      if (route.componentFilePath && fs.existsSync(route.componentFilePath)) {
        const inspection = this.componentScanner.inspectComponent(route.componentFilePath);
        const node = routeNodes[route.nodeId];
        if (node) {
          if (inspection.title) node.title = inspection.title;
          node.interactiveElements = inspection.interactiveElements;
        }
      }
    }

    // Also inspect shared layout components and attach to root node
    this.enrichWithLayoutComponents(routeNodes);

    // Step 3: Scan all component files for intra-page state machines
    const routeNodeMap = new Map<string, string>(
      routes
        .filter((r) => r.componentFilePath)
        .map((r) => [r.componentFilePath!, r.nodeId])
    );
    const { stateNodes: stateNodeList, stateEdges } = this.stateScanner.scanAll(
      this.sourceDir,
      routeNodeMap
    );

    const stateNodes: Record<string, StateNode> = {};
    for (const sn of stateNodeList) stateNodes[sn.id] = sn;

    console.log(`[CodebaseScanner] State nodes discovered: ${stateNodeList.length}`);
    console.log(`[CodebaseScanner] State edges discovered: ${stateEdges.length}`);

    // Step 4: Trace URL navigation edges
    const navigationEdges = this.eventTracer.traceNavigationEdges(routeNodes, routes);
    console.log(`[CodebaseScanner] Navigation edges discovered: ${navigationEdges.length}`);

    // Step 5: Synthesize raw workflow clusters
    const rawWorkflows = this.workflowSynthesizer.synthesizeWorkflows(
      routeNodes,
      stateNodes,
      navigationEdges,
      stateEdges
    );
    console.log(`[CodebaseScanner] Raw workflows clustered: ${rawWorkflows.length}`);

    // Step 6: LLM enrichment
    const allEdges: GraphEdge[] = [
      ...navigationEdges,
      ...this.eventTracer.promoteStateEdges(stateEdges),
    ];

    const enrichedWorkflows: EnrichedWorkflow[] = await this.llmEnricher.enrich(
      rawWorkflows,
      routeNodes,
      stateNodes,
      allEdges,
      stateEdges,
      this.sourceDir
    );
    console.log(`[CodebaseScanner] Enriched workflows: ${enrichedWorkflows.length}`);

    return {
      generatedAt: new Date().toISOString(),
      sourceDir: this.sourceDir,
      nodes: routeNodes,
      stateNodes,
      edges: allEdges,
      stateEdges,
      workflows: enrichedWorkflows,
    };
  }

  // ─── Layout component enrichment ─────────────────────────────────────────

  private enrichWithLayoutComponents(nodes: Record<string, GraphNode>): void {
    // Discover layout/shared components dynamically
    const componentDir = path.join(this.sourceDir, 'components');
    if (!fs.existsSync(componentDir)) return;

    const layoutCandidates = fs.readdirSync(componentDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(tsx|jsx)$/.test(e.name))
      .map((e) => path.join(componentDir, e.name));

    // Find a "root" or "dashboard" node to attach global elements to
    const rootNodeId = Object.keys(nodes).find(
      (id) => id.includes('dashboard') || id.includes('home') || id.includes('root') || id.includes('index')
    ) ?? Object.keys(nodes)[0];

    if (!rootNodeId || !nodes[rootNodeId]) return;

    for (const compPath of layoutCandidates) {
      const name = path.basename(compPath, path.extname(compPath)).toLowerCase();
      // Only attach sidebar, navbar, header, nav, shell, layout type components
      if (!/(sidebar|navbar|header|nav|shell|layout|topbar)/i.test(name)) continue;

      const inspection = this.componentScanner.inspectComponent(compPath);
      nodes[rootNodeId].interactiveElements.push(...inspection.interactiveElements);
    }
  }

  // ─── Source directory resolution ──────────────────────────────────────────

  private resolveSourceDir(providedDir?: string): string {
    if (providedDir) {
      const resolved = path.resolve(process.cwd(), providedDir);
      if (fs.existsSync(resolved)) return resolved;
      throw new Error(
        `Source directory not found: "${resolved}". Pass --src <path> pointing at the target ` +
          `application's source root.`
      );
    }

    const defaultSrc = path.resolve(process.cwd(), 'src');
    if (fs.existsSync(defaultSrc)) return defaultSrc;

    throw new Error(
      `No source directory specified and no "./src" directory found in ${process.cwd()}. ` +
        `Pass --src <path> pointing at the target application's source root (e.g. --src apps/myapp/src).`
    );
  }
}
