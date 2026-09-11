import { GraphNode, GraphEdge, StateNode, StateTransitionEdge, RawWorkflow, EnrichedWorkflow } from '../types.js';
import { PatternClassifier } from './patternClassifier.js';

/**
 * WorkflowSynthesizer is now a thin, stateless wrapper over PatternClassifier.
 * It holds no hardcoded node IDs, no hardcoded edge IDs, no version logic.
 */
export class WorkflowSynthesizer {
  private classifier = new PatternClassifier();

  public synthesizeWorkflows(
    routeNodes: Record<string, GraphNode>,
    stateNodes: Record<string, StateNode>,
    navigationEdges: GraphEdge[],
    stateEdges: StateTransitionEdge[]
  ): RawWorkflow[] {
    return this.classifier.cluster(routeNodes, stateNodes, navigationEdges, stateEdges);
  }
}
