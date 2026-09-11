import * as crypto from 'crypto';
import { GraphEdge, WorkflowPath, ActionType } from '@living-graph/extractor';
import { TestGenerator } from './testGenerator.js';
import { ComputerUseActionTrace, ComputerUseWalkResult } from './computerUseWalker.js';

export interface AgenticReplayStep {
  stepNumber: number;
  edgeId: string;
  narration: string;
  screenshotPath: string;
}

export interface AgenticReplayArtifacts {
  workflow: WorkflowPath;
  edges: GraphEdge[];
  specContent: string;
  /** 1:1 with `edges`/`workflow.edgeIds`, in the `step_NN_<edgeId>` naming convention the rest of the pipeline (bundling, Cloud AssetStudio) already expects. */
  steps: AgenticReplayStep[];
}

const TOOL_TO_ACTION_TYPE: Record<string, ActionType> = {
  left_click: 'click',
  double_click: 'click',
  triple_click: 'click',
  right_click: 'click',
  middle_click: 'click',
  left_click_drag: 'click',
  type: 'fill',
  key: 'keydown',
  hold_key: 'keydown',
};

/** Actions that don't represent a user-meaningful tutorial step on their own (pure observation/navigation-adjacent noise). */
const SKIPPED_TOOLS = new Set(['screenshot', 'mouse_move', 'cursor_position', 'zoom', 'wait']);

function slugify(text: string, maxLen = 40): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen) || 'agentic-goal'
  );
}

function deriveTargetLabel(trace: ComputerUseActionTrace): string {
  if (trace.narration) return trace.narration.replace(/\.$/, '');
  const input = trace.input as any;
  if (trace.toolName === 'type') return `Type "${input?.text ?? ''}"`;
  if (trace.toolName === 'key') return `Press ${input?.text ?? ''}`;
  return `${trace.toolName} action`;
}

/**
 * Converts a completed ComputerUseWalker run into the same shape a
 * deterministic AutonomousWalker run would have produced — synthetic
 * GraphEdge/WorkflowPath objects plus a replayable Playwright .spec.ts via
 * the existing TestGenerator — so downstream bundling, Cloud AssetStudio
 * rendering, and CI replay all work identically regardless of which engine
 * walked the app. This is what freezes an otherwise one-off agentic run
 * into a deterministic, self-contained artifact.
 */
export function buildAgenticReplayArtifacts(
  result: ComputerUseWalkResult,
  options?: { baseUrl?: string; startPath?: string }
): AgenticReplayArtifacts {
  const meaningfulTraces = result.traces.filter((t) => !t.isError && !SKIPPED_TOOLS.has(t.toolName));

  const workflowId = `agentic_${slugify(result.goal)}_${crypto.createHash('sha1').update(result.goal).digest('hex').slice(0, 6)}`;

  const edges: GraphEdge[] = meaningfulTraces.map((trace, idx) => {
    const edgeId = `${workflowId}_step_${idx + 1}`;
    return {
      id: edgeId,
      sourceNodeId: `${workflowId}_node_${idx}`,
      targetNodeId: `${workflowId}_node_${idx + 1}`,
      action: {
        type: TOOL_TO_ACTION_TYPE[trace.toolName] ?? 'click',
        targetSelector: trace.selector || '',
        targetLabel: deriveTargetLabel(trace),
      },
      narration: trace.narration || deriveTargetLabel(trace),
      playwrightCode: trace.playwrightCode || `// ${trace.toolName}(${JSON.stringify(trace.input)})`,
    };
  });

  const workflow: WorkflowPath = {
    id: workflowId,
    title: result.goal,
    description: result.finalMessage || `Agentic walk toward: ${result.goal}`,
    startNodeId: `${workflowId}_node_0`,
    endNodeId: `${workflowId}_node_${edges.length}`,
    edgeIds: edges.map((e) => e.id),
  };

  const testGenerator = new TestGenerator();
  const specContent = testGenerator.generateSpec(workflow, edges, options?.baseUrl, options?.startPath);

  const steps: AgenticReplayStep[] = meaningfulTraces.map((trace, idx) => ({
    stepNumber: idx + 1,
    edgeId: edges[idx].id,
    narration: edges[idx].narration,
    screenshotPath: trace.screenshotPath,
  }));

  return { workflow, edges, specContent, steps };
}
