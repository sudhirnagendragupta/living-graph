export type ElementRole =
  | 'button'
  | 'link'
  | 'input'
  | 'select'
  | 'tab'
  | 'menuitem'
  | 'textbox'
  | 'checkbox';

export interface InteractiveElement {
  id: string;
  role: ElementRole;
  label: string;
  selector: string;
  description?: string;
  branchCondition?: string;
}

export interface StateInvariants {
  urlPattern: string;
  requiresAuth: boolean;
  expectedElements: string[];
}

export interface GraphNode {
  id: string;
  route: string;
  title: string;
  description: string;
  invariants: StateInvariants;
  interactiveElements: InteractiveElement[];
}

export type ActionType = 'click' | 'fill' | 'select' | 'navigate' | 'submit' | 'keydown';

export interface GraphEdgeAction {
  type: ActionType;
  targetSelector: string;
  targetRole?: ElementRole;
  targetLabel?: string;
  payload?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  action: GraphEdgeAction;
  narration: string;
  playwrightCode: string;
  branchCondition?: string;
}

// ─── Intra-page state machine ───────────────────────────────────────────────

/**
 * Kind of intra-page state, classified from useState pattern.
 * All kinds are detected from community-standard React conventions only.
 */
export type StateNodeKind =
  | 'modal'        // boolean useState guarding a conditional overlay/dialog
  | 'tab'          // string/enum useState selecting between sibling panels
  | 'wizard_step'  // numeric useState tracking a linear multi-step sequence
  | 'bulk_select'  // array useState accumulating selected item IDs
  | 'filter'       // string useState bound to a standalone search/filter input
  | 'form_field'   // string useState bound to an input that is part of a larger form/dialog/wizard
  | 'toggle'       // boolean useState bound to a checkbox or switch
  | 'form_group';  // synthetic node registered for a <form>'s submit edge to resolve to — not a real field, never clustered as one

export interface StateNode {
  id: string;                  // "state_{ComponentName}_{stateName}"
  kind: StateNodeKind;
  parentRouteNodeId: string;   // URL route node this state lives in
  stateName: string;           // useState variable name
  setterName: string;          // setter function name
  initialValue: string;        // raw string of initial value: "false", "0", "'profile'", "[]"
  possibleValues?: string[];   // inferred from type annotation or JSX
  branchCondition?: string;    // raw condition expression if state is inside a conditional branch
  sourceFile: string;          // basename of the component file
  /**
   * For 'form_field' kind: identifies the enclosing <form> element (by AST source
   * position) so sibling fields in the same form cluster into one workflow.
   * Undefined when the field has no enclosing <form> ancestor.
   */
  formGroupId?: string;
  /**
   * For 'form_field' kind: the boolean state variable name gating this
   * field's JSX visibility, e.g. "showInviteModal" for an input rendered as
   * `{showInviteModal && <input .../>}`. Lets PatternClassifier detect that
   * this field's workflow must open that modal first — without this, a
   * synthesized workflow tries to fill a field that's still hidden.
   * Undefined when the field isn't behind any conditional render.
   */
  enclosingConditionalState?: string;
}

export interface StateTransitionEdge {
  id: string;
  sourceStateId: string;       // StateNode id or GraphNode id
  targetStateId: string;       // StateNode id or GraphNode id
  triggerSelector: string;     // Playwright-ready selector
  triggerLabel: string;
  action: GraphEdgeAction;
  narration: string;           // filled by LLMEnricher
  playwrightCode: string;
  branchCondition?: string;
  /**
   * The state variable gating this edge's trigger element's own JSX
   * visibility (e.g. "activeTab" for a button rendered as
   * `{activeTab === 'team' && <button onClick={...}>}`). Lets a
   * precondition edge chain recursively: this button itself might be
   * hidden behind a tab that must be selected first.
   */
  enclosingConditionalState?: string;
}

// ─── Workflow synthesis ──────────────────────────────────────────────────────

export type WorkflowPattern = StateNodeKind | 'url_chain' | 'settings' | 'exploration';

export interface RawWorkflow {
  id: string;
  pattern: WorkflowPattern;
  parentNodeId: string;
  candidateEdgeIds: string[];
  stateNodeIds: string[];
  branchCondition?: string;
}

export interface EnrichedStep {
  edgeId: string;
  narration: string;
  playwrightCode: string;
}

export interface EnrichedWorkflow {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  priority: 'P0' | 'P1' | 'P2';
  persona?: string;
  startNodeId: string;
  endNodeId: string;
  edgeIds: string[];
  steps: EnrichedStep[];
  branchCondition?: string;
}

// ─── Top-level graph ─────────────────────────────────────────────────────────

export interface WorkflowGraph {
  version?: 'v1' | 'v2';
  generatedAt: string;
  sourceDir: string;
  nodes: Record<string, GraphNode>;
  stateNodes: Record<string, StateNode>;
  edges: GraphEdge[];
  stateEdges: StateTransitionEdge[];
  workflows: EnrichedWorkflow[];
}

// ─── Run-vs-run diff ─────────────────────────────────────────────────────────

export type TopicStatus = 'new' | 'changed' | 'stable' | 'removed';

export interface WorkflowDiff {
  workflowId: string;
  title: string;
  status: TopicStatus;
  changedEdges: string[];
  addedEdges: string[];
  removedEdges: string[];
  driftReason?: string;
}

export interface GraphDiff {
  previousGeneratedAt: string;
  currentGeneratedAt: string;
  addedNodes: string[];
  removedNodes: string[];
  addedStateNodes: string[];
  removedStateNodes: string[];
  brokenEdges: GraphEdge[];
  addedEdges: GraphEdge[];
  driftDetected: boolean;
  affectedWorkflows: Array<{
    workflowId: string;
    title: string;
    driftReason?: string;
    v1Path: string[];
    v2Path: string[];
  }>;
  workflowDiffs: WorkflowDiff[];
  hasChanges: boolean;
}

// Legacy compatibility — keep WorkflowPath so CLI/Cloud don't break immediately
/** @deprecated Use EnrichedWorkflow instead */
export interface WorkflowPath {
  id: string;
  title: string;
  description: string;
  startNodeId: string;
  endNodeId: string;
  edgeIds: string[];
}
