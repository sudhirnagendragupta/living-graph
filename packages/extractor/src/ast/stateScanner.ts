import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { StateNode, StateNodeKind, StateTransitionEdge, GraphEdgeAction, ActionType } from '../types.js';
import { formatSemanticNarration, cleanSelectorToLabel, cleanLabelText } from '../semanticNarration.js';

export interface StateScanResult {
  stateNodes: StateNode[];
  stateEdges: StateTransitionEdge[];
}

interface UseStateDeclaration {
  stateName: string;
  setterName: string;
  initialValue: string;
  possibleValues?: string[];
  branchCondition?: string;
  node: ts.VariableDeclaration;
}

interface BoundInputSite {
  attrs: Record<string, string>;
  insideForm: boolean;
  formGroupId?: string;
  enclosingConditionalState?: string;
}

const SEARCH_NAME_PATTERN = /search|filter|query|keyword/i;

/**
 * Scans every React/TSX component file and extracts its complete intra-page
 * state machine — every useState declaration, its semantic pattern, every
 * user action that triggers a state transition, and every <form> submission.
 *
 * Detection is grounded entirely in community-standard React/TypeScript
 * conventions. No app-specific names, routes, or configurations are assumed.
 */
export class StateScanner {
  public scanAll(
    sourceDir: string,
    routeNodeMap: Map<string, string>
  ): StateScanResult {
    const allStateNodes: StateNode[] = [];
    const allStateEdges: StateTransitionEdge[] = [];

    const files = this.collectSourceFiles(sourceDir);

    for (const filePath of files) {
      const routeNodeId = routeNodeMap.get(filePath);
      const parentNodeId = routeNodeId ?? `component_${path.basename(filePath, path.extname(filePath))}`;
      const result = this.scanFile(filePath, parentNodeId);
      allStateNodes.push(...result.stateNodes);
      allStateEdges.push(...result.stateEdges);
    }

    return { stateNodes: allStateNodes, stateEdges: allStateEdges };
  }

  public scanFile(filePath: string, parentRouteNodeId: string): StateScanResult {
    if (!fs.existsSync(filePath)) return { stateNodes: [], stateEdges: [] };

    const sourceText = fs.readFileSync(filePath, 'utf-8');
    if (!sourceText.includes('useState')) return { stateNodes: [], stateEdges: [] };

    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const componentName = path.basename(filePath, path.extname(filePath));
    const stateNodes: StateNode[] = [];
    const stateEdges: StateTransitionEdge[] = [];

    const declarations = this.collectUseStateDeclarations(sourceFile);

    for (const decl of declarations) {
      const classification = this.classifyState(decl, sourceFile);
      if (!classification) continue; // unclassified (loader, error, animation) — skip

      const stateNode: StateNode = {
        id: `state_${componentName}_${decl.stateName}`,
        kind: classification.kind,
        parentRouteNodeId,
        stateName: decl.stateName,
        setterName: decl.setterName,
        initialValue: decl.initialValue,
        possibleValues: decl.possibleValues,
        branchCondition: decl.branchCondition,
        sourceFile: path.basename(filePath),
        formGroupId: classification.formGroupId,
        enclosingConditionalState: classification.enclosingConditionalState,
      };
      stateNodes.push(stateNode);

      const edges = this.extractTransitionEdges(stateNode, sourceFile, componentName);
      stateEdges.push(...edges);
    }

    const crossEdges = this.detectCrossComponentMounting(
      stateNodes,
      sourceFile,
      sourceText,
      parentRouteNodeId,
      componentName
    );
    stateEdges.push(...crossEdges);

    const formSubmissions = this.detectFormSubmissions(sourceFile, componentName, parentRouteNodeId);
    stateNodes.push(...formSubmissions.stateNodes);
    stateEdges.push(...formSubmissions.stateEdges);

    return { stateNodes, stateEdges };
  }

  // ─── useState Declaration Mining ──────────────────────────────────────────

  private collectUseStateDeclarations(sourceFile: ts.SourceFile): UseStateDeclaration[] {
    const results: UseStateDeclaration[] = [];

    const walk = (node: ts.Node, branchCondition?: string): void => {
      let currentBranch = branchCondition;

      if (ts.isIfStatement(node)) {
        const condText = node.expression.getText(sourceFile).trim();
        if (this.isFeatureFlagCondition(condText)) {
          ts.forEachChild(node.thenStatement, (child) => walk(child, condText));
          if (node.elseStatement) {
            ts.forEachChild(node.elseStatement, (child) => walk(child, `!(${condText})`));
          }
          return;
        }
      }

      if (ts.isVariableDeclaration(node)) {
        if (
          node.initializer &&
          ts.isCallExpression(node.initializer) &&
          this.isUseStateCall(node.initializer)
        ) {
          const decl = this.parseUseStateDeclaration(node, node.initializer, sourceFile, currentBranch);
          if (decl) results.push(decl);
        }
      }

      ts.forEachChild(node, (child) => walk(child, currentBranch));
    };

    walk(sourceFile);
    return results;
  }

  private isUseStateCall(call: ts.CallExpression): boolean {
    const expr = call.expression;
    if (ts.isIdentifier(expr) && expr.text === 'useState') return true;
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.name) &&
      expr.name.text === 'useState'
    ) return true;
    return false;
  }

  private parseUseStateDeclaration(
    varDecl: ts.VariableDeclaration,
    call: ts.CallExpression,
    sourceFile: ts.SourceFile,
    branchCondition?: string
  ): UseStateDeclaration | null {
    if (!varDecl.name || !ts.isArrayBindingPattern(varDecl.name)) return null;
    const elements = varDecl.name.elements;
    if (elements.length < 2) return null;

    const first = elements[0];
    const second = elements[1];
    if (!ts.isBindingElement(first) || !ts.isBindingElement(second)) return null;
    if (!ts.isIdentifier(first.name) || !ts.isIdentifier(second.name)) return null;

    const stateName = first.name.text;
    const setterName = second.name.text;

    const initialValue = call.arguments[0]
      ? call.arguments[0].getText(sourceFile).trim()
      : 'undefined';

    let possibleValues: string[] | undefined;
    if (call.typeArguments && call.typeArguments.length > 0) {
      const typeArg = call.typeArguments[0];
      if (ts.isUnionTypeNode(typeArg)) {
        possibleValues = typeArg.types
          .filter(ts.isLiteralTypeNode)
          .map((t) => t.literal.getText(sourceFile).replace(/['"]/g, ''));
      }
    }

    return { stateName, setterName, initialValue, possibleValues, branchCondition, node: varDecl };
  }

  // ─── Pattern Classification ───────────────────────────────────────────────

  private classifyState(
    decl: UseStateDeclaration,
    sourceFile: ts.SourceFile
  ): { kind: StateNodeKind; formGroupId?: string; enclosingConditionalState?: string } | null {
    const { stateName, setterName, initialValue } = decl;
    const sourceText = sourceFile.getFullText();

    // Form field, input, or select state: bound to input/textarea/select onChange
    const inputSite = this.findBoundInputSite(setterName, sourceFile);
    if (inputSite) {
      const looksLikeSearch =
        SEARCH_NAME_PATTERN.test(stateName) ||
        (inputSite.attrs['placeholder'] && SEARCH_NAME_PATTERN.test(inputSite.attrs['placeholder'])) ||
        (inputSite.attrs['aria-label'] && SEARCH_NAME_PATTERN.test(inputSite.attrs['aria-label']));

      if (looksLikeSearch && !inputSite.insideForm && (initialValue === "''" || initialValue === '""' || initialValue === '``')) {
        return { kind: 'filter' };
      }
      return {
        kind: 'form_field',
        formGroupId: inputSite.formGroupId,
        enclosingConditionalState: inputSite.enclosingConditionalState,
      };
    }

    // TOGGLE: boolean state bound to a checkbox onChange
    if (initialValue === 'false' || initialValue === 'true') {
      if (this.isCheckboxBound(setterName, sourceFile)) return { kind: 'toggle' };
    }

    // MODAL: boolean state whose name suggests visibility, confirmed by conditionally rendering
    // either a real dialog/overlay OR an inline form control (an inline
    // "toggle reveals a field/button" pattern is functionally the same
    // precondition for workflow-walking purposes as a true modal, even
    // without dialog/backdrop styling — a button-triggered inline tag input
    // gated by `{showAddTag ? <input/> : <button/>}` is just as real a
    // precondition as `{showInviteModal && <dialog/>}`).
    if (initialValue === 'false' || initialValue === 'true') {
      if (
        this.matchesModalNamingConvention(stateName) &&
        this.hasConditionalOverlayRender(stateName, sourceFile)
      ) return { kind: 'modal' };
    }

    // WIZARD_STEP: numeric state with increment setter calls
    if (/^[0-9]+$/.test(initialValue)) {
      if (this.hasStepIncrement(setterName, sourceText)) return { kind: 'wizard_step' };
    }

    // BULK_SELECT: empty array state with includes/filter logic in setter
    if (initialValue === '[]') {
      if (this.hasBulkSelectPattern(setterName, sourceText)) return { kind: 'bulk_select' };
    }

    // TAB / OPTION: string literal state with setter called from sibling or mapped buttons
    if (
      (/^['"`][a-zA-Z0-9_-]+['"`]$/.test(initialValue) || decl.possibleValues?.length) &&
      initialValue !== "''" &&
      initialValue !== '""'
    ) {
      if (this.hasSiblingTabButtons(setterName, sourceText)) return { kind: 'tab' };
    }

    return null; // unclassified — loading state, error state, animation, etc.
  }

  private matchesModalNamingConvention(stateName: string): boolean {
    return /^(show|open|is)[A-Z]/.test(stateName) ||
      /Modal$|Dialog$|Drawer$|Popup$|Overlay$/.test(stateName);
  }

  /**
   * Finds every `{stateName && <jsx/>}` or `{stateName ? <jsx/> : ...}`
   * gate in the file (via AST, not whitespace-sensitive substring matching
   * — `{showAddTag ? (` with the space Prettier/ESLint add would never
   * have matched the old `{${stateName}?` check) and, for each one, checks
   * only THAT gate's own revealed JSX subtree — not the whole file, which
   * would make this true for nearly any `show*`/`is*` boolean in a
   * component that has a form anywhere in it — for either genuine
   * dialog/overlay styling or a real form control being revealed.
   */
  private hasConditionalOverlayRender(stateName: string, sourceFile: ts.SourceFile): boolean {
    let found = false;

    const revealsQualifyingContent = (node: ts.Node): boolean => {
      const text = node.getText(sourceFile);
      return (
        text.includes('fixed inset-0') ||
        text.includes('role="dialog"') ||
        text.includes("role='dialog'") ||
        text.includes('z-50') ||
        text.includes('backdrop') ||
        /<(input|form|textarea|select)\b/.test(text)
      );
    };

    const walk = (node: ts.Node): void => {
      if (found) return;

      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        node.left.getText(sourceFile).trim() === stateName &&
        revealsQualifyingContent(node.right)
      ) {
        found = true;
        return;
      }

      if (
        ts.isConditionalExpression(node) &&
        node.condition.getText(sourceFile).trim() === stateName &&
        (revealsQualifyingContent(node.whenTrue) || revealsQualifyingContent(node.whenFalse))
      ) {
        found = true;
        return;
      }

      ts.forEachChild(node, walk);
    };

    walk(sourceFile);
    return found;
  }

  /**
   * Locate the JSX input/textarea/select element whose onChange calls
   * `setterName(e.target.value)`, and determine whether it lives inside a
   * <form> ancestor (used to cluster sibling form fields together).
   */
  private findBoundInputSite(setterName: string, sourceFile: ts.SourceFile): BoundInputSite | null {
    let result: BoundInputSite | null = null;

    const walk = (node: ts.Node): void => {
      if (result) return;

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === setterName
      ) {
        const arg = node.arguments[0];
        const argText = arg ? arg.getText(sourceFile) : '';

        if (argText.includes('.target.value')) {
          let current: ts.Node = node;
          let depth = 0;
          let jsxElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;

          while (current.parent && depth < 10) {
            current = current.parent;
            depth++;
            if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
              jsxElement = current;
              break;
            }
          }

          if (jsxElement) {
            const attrs = this.getJsxAttrs(jsxElement, sourceFile);
            const formNode = this.findEnclosingForm(jsxElement, sourceFile);
            result = {
              attrs,
              insideForm: !!formNode,
              formGroupId: formNode ? `form_${formNode.getStart(sourceFile)}` : undefined,
              enclosingConditionalState: this.findEnclosingConditionalState(jsxElement, sourceFile),
            };
          }
        }
      }

      if (!result) ts.forEachChild(node, walk);
    };

    walk(sourceFile);
    return result;
  }

  private findEnclosingForm(
    start: ts.Node,
    sourceFile: ts.SourceFile
  ): ts.JsxOpeningElement | null {
    let current: ts.Node = start;
    let depth = 0;
    while (current.parent && depth < 40) {
      current = current.parent;
      depth++;
      if (ts.isJsxElement(current) && current.openingElement.tagName.getText(sourceFile) === 'form') {
        return current.openingElement;
      }
    }
    return null;
  }

  /**
   * Walks up from a bound JSX input element looking for the nearest
   * `{condition && <jsx>}` or `{condition ? <jsx> : <jsx>}` ancestor whose
   * shown branch contains it, and returns the guarding condition's source
   * text (e.g. "showInviteModal"). This is the standard React idiom for
   * conditionally-rendered content (a modal, a wizard step, a collapsed
   * panel) — without detecting it, a workflow can synthesize a step that
   * fills a field the UI never actually revealed yet.
   */
  private findEnclosingConditionalState(start: ts.Node, sourceFile: ts.SourceFile): string | undefined {
    let current: ts.Node = start;
    let depth = 0;
    while (current.parent && depth < 40) {
      const child = current;
      current = current.parent;
      depth++;

      if (
        ts.isBinaryExpression(current) &&
        current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        current.right === child
      ) {
        return current.left.getText(sourceFile).trim();
      }

      if (ts.isConditionalExpression(current)) {
        if (current.whenTrue === child) {
          return current.condition.getText(sourceFile).trim();
        }
        if (current.whenFalse === child) {
          return `!(${current.condition.getText(sourceFile).trim()})`;
        }
      }
    }
    return undefined;
  }

  private isCheckboxBound(setterName: string, sourceFile: ts.SourceFile): boolean {
    const sourceText = sourceFile.getFullText();
    return (
      (sourceText.includes(`type="checkbox"`) || sourceText.includes("type='checkbox'")) &&
      sourceText.includes(`${setterName}(e.target.checked)`)
    );
  }

  /**
   * Detects a numeric step counter's "advance" call. Deliberately tolerant of
   * wrapping (Math.min/Math.max clamps, parenthesized arrow params) since a
   * literal `setX(prev + 1)` match misses the common `setX((prev) =>
   * Math.min(prev + 1, total))` idiom — we only need to know that *some*
   * `+ 1` expression appears within the setter's call arguments.
   */
  private hasStepIncrement(setterName: string, sourceText: string): boolean {
    const escaped = setterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const callPattern = new RegExp(`${escaped}\\(([^;]{0,120})`, 'g');
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(sourceText)) !== null) {
      if (/\+\s*1\b/.test(match[1])) return true;
    }
    return false;
  }

  private hasBulkSelectPattern(setterName: string, sourceText: string): boolean {
    return (
      sourceText.includes(`${setterName}(prev =>`) &&
      (sourceText.includes('.filter(') || sourceText.includes('.includes(')) &&
      (sourceText.includes('...prev') || sourceText.includes('prev.filter'))
    );
  }

  private hasSiblingTabButtons(setterName: string, sourceText: string): boolean {
    const callPattern = new RegExp(`onClick.*${setterName}\\(`, 'g');
    const matches = sourceText.match(callPattern);
    if (matches !== null && matches.length >= 2) return true;

    // Detect buttons or options mapped over an array or enum (e.g. ['low', 'medium', ...].map)
    const mapPattern = new RegExp(`\\.(map|forEach)\\s*\\([\\s\\S]{0,400}${setterName}\\(`, 'g');
    return mapPattern.test(sourceText);
  }

  private isFeatureFlagCondition(condText: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*\(/.test(condText) ||
      /^[A-Z_][A-Z0-9_]+$/.test(condText) ||
      condText.includes('process.env.') ||
      condText.includes('import.meta.env.');
  }

  // ─── Setter Call Site → Transition Edge ──────────────────────────────────

  private extractTransitionEdges(
    stateNode: StateNode,
    sourceFile: ts.SourceFile,
    componentName: string
  ): StateTransitionEdge[] {
    const edges: StateTransitionEdge[] = [];
    let edgeIndex = 0;

    const walk = (node: ts.Node, branchCondition?: string): void => {
      let currentBranch = branchCondition;
      if (ts.isConditionalExpression(node) || ts.isIfStatement(node)) {
        const condNode = ts.isConditionalExpression(node) ? node.condition : (node as ts.IfStatement).expression;
        const condText = condNode.getText(sourceFile).trim();
        if (this.isFeatureFlagCondition(condText)) {
          currentBranch = condText;
        }
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === stateNode.setterName
      ) {
        const newValue = node.arguments[0]?.getText(sourceFile).trim() ?? 'undefined';

        // A wizard_step setter is typically called from both an "advance"
        // handler (+1) and a "go back" handler (-1). Only the advance call
        // site represents the forward tutorial path we want to walk; the
        // decrement call site would otherwise get folded in as a spurious
        // extra step alongside it.
        if (stateNode.kind === 'wizard_step' && /-\s*1\b/.test(newValue) && !/\+\s*1\b/.test(newValue)) {
          ts.forEachChild(node, (child) => walk(child, currentBranch));
          return;
        }

        const trigger = this.findTriggerElement(node, sourceFile);
        if (!trigger) {
          ts.forEachChild(node, (child) => walk(child, currentBranch));
          return;
        }

        const edgeId = `state_edge_${componentName}_${stateNode.stateName}_${edgeIndex++}`;
        const playwrightCode = this.generatePlaywrightCode(stateNode, trigger, newValue);

        edges.push({
          id: edgeId,
          sourceStateId: stateNode.id,
          targetStateId: stateNode.id,
          triggerSelector: trigger.selector,
          triggerLabel: trigger.label,
          action: {
            type: trigger.actionType,
            targetSelector: trigger.selector,
            targetLabel: trigger.label,
            payload: newValue !== 'undefined' ? { value: newValue } : undefined,
          },
          narration: formatSemanticNarration(trigger.actionType, trigger.label, trigger.selector, edgeId),
          playwrightCode,
          branchCondition: currentBranch,
          enclosingConditionalState: trigger.enclosingConditionalState,
        });
      }

      ts.forEachChild(node, (child) => walk(child, currentBranch));
    };

    walk(sourceFile);
    return edges;
  }

  /**
   * Find the JSX element whose event handler is responsible for this setter
   * call. Handles two shapes: the setter called inline inside a JSX attribute
   * (`onClick={() => setX(...)}`), and the setter called inside a named
   * handler function (`const handleNext = () => { ...; setX(...); }`) that is
   * itself referenced elsewhere as `onClick={handleNext}` — an extremely
   * common React idiom that a pure ancestor-climb from the call site can
   * never see, since the JSX usage and the call site live in different
   * subtrees.
   */
  private findTriggerElement(
    callNode: ts.Node,
    sourceFile: ts.SourceFile
  ): { selector: string; label: string; actionType: GraphEdgeAction['type']; enclosingConditionalState?: string } | null {
    const inline = this.climbForJsxHandler(callNode, sourceFile);
    if (inline) return inline;

    const handlerName = this.findEnclosingHandlerName(callNode);
    if (handlerName) {
      return this.findHandlerReferenceTrigger(handlerName, sourceFile);
    }

    return null;
  }

  private climbForJsxHandler(
    callNode: ts.Node,
    sourceFile: ts.SourceFile
  ): { selector: string; label: string; actionType: GraphEdgeAction['type']; enclosingConditionalState?: string } | null {
    let current: ts.Node = callNode;
    let depth = 0;

    while (current.parent && depth < 10) {
      current = current.parent;
      depth++;

      if (ts.isJsxAttribute(current)) {
        const attrName = current.name.getText(sourceFile);
        if (!['onClick', 'onChange', 'onSubmit', 'onKeyDown'].includes(attrName)) continue;

        const jsxElement = current.parent?.parent;
        if (!jsxElement) continue;
        if (!ts.isJsxOpeningElement(jsxElement) && !ts.isJsxSelfClosingElement(jsxElement)) continue;

        const selector = this.extractSelector(jsxElement, sourceFile);
        if (!selector) continue;

        const label = this.extractLabel(jsxElement, sourceFile);
        const actionType = this.inferActionType(attrName, jsxElement, sourceFile);
        const enclosingConditionalState = this.findEnclosingConditionalState(jsxElement, sourceFile);

        return { selector, label, actionType, enclosingConditionalState };
      }
    }

    return null;
  }

  /**
   * Climb from a call site to the nearest enclosing named function — either
   * `const handleX = () => {...}` / `function handleX() {...}` — and return
   * its name, so we can then search the file for where that name is wired up
   * as a JSX event handler.
   */
  private findEnclosingHandlerName(node: ts.Node): string | null {
    let current: ts.Node = node;
    let depth = 0;

    while (current.parent && depth < 60) {
      current = current.parent;
      depth++;

      if (
        ts.isVariableDeclaration(current) &&
        ts.isIdentifier(current.name) &&
        current.initializer &&
        (ts.isArrowFunction(current.initializer) || ts.isFunctionExpression(current.initializer))
      ) {
        return current.name.text;
      }

      if (ts.isFunctionDeclaration(current) && current.name) {
        return current.name.text;
      }
    }

    return null;
  }

  private findHandlerReferenceTrigger(
    handlerName: string,
    sourceFile: ts.SourceFile
  ): { selector: string; label: string; actionType: GraphEdgeAction['type']; enclosingConditionalState?: string } | null {
    const escaped = handlerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const refPattern = new RegExp(`\\{\\s*${escaped}\\s*\\}|\\b${escaped}\\s*\\(`);
    let result: { selector: string; label: string; actionType: GraphEdgeAction['type']; enclosingConditionalState?: string } | null = null;

    const walk = (node: ts.Node): void => {
      if (result) return;

      if (ts.isJsxAttribute(node) && node.initializer) {
        const attrName = node.name.getText(sourceFile);
        if (['onClick', 'onChange', 'onSubmit', 'onKeyDown'].includes(attrName)) {
          const initText = node.initializer.getText(sourceFile);
          if (refPattern.test(initText)) {
            const jsxElement = node.parent?.parent;
            if (jsxElement && (ts.isJsxOpeningElement(jsxElement) || ts.isJsxSelfClosingElement(jsxElement))) {
              const selector = this.extractSelector(jsxElement, sourceFile);
              if (selector) {
                result = {
                  selector,
                  label: this.extractLabel(jsxElement, sourceFile),
                  actionType: this.inferActionType(attrName, jsxElement, sourceFile),
                  enclosingConditionalState: this.findEnclosingConditionalState(jsxElement, sourceFile),
                };
              }
            }
          }
        }
      }

      if (!result) ts.forEachChild(node, walk);
    };

    walk(sourceFile);
    return result;
  }

  private extractSelector(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
  ): string | null {
    const attrs = this.getJsxAttrs(node, sourceFile);
    const tag = node.tagName.getText(sourceFile);

    const testId = attrs['data-testid'];
    if (testId && !testId.includes('${')) {
      return `${tag}[data-testid="${testId}"]`;
    }
    const ariaLabel = attrs['aria-label'];
    if (ariaLabel && !ariaLabel.includes('${')) {
      return `${tag}[aria-label="${ariaLabel}"]`;
    }
    const id = attrs['id'];
    if (id) return `${tag}#${id}`;

    const placeholder = attrs['placeholder'];
    if (placeholder && !placeholder.includes('${')) {
      return `${tag}[placeholder*="${placeholder.slice(0, 20)}"]`;
    }

    const parent = node.parent;
    if (ts.isJsxElement(parent)) {
      const text = parent.children
        .filter(ts.isJsxText)
        .map((c) => c.getText(sourceFile).trim())
        .filter(Boolean)
        .join(' ')
        .trim();
      if (text && text.length > 1 && text.length < 40 && !text.includes('{')) {
        return `${tag}:has-text("${text}")`;
      }
    }

    if (testId && testId.includes('${')) {
      const prefix = testId.split('$')[0].replace(/^[`'"]+|[`'"]+$/g, '');
      return `${tag}[data-testid^="${prefix}"]`;
    }

    return null;
  }

  private extractLabel(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
  ): string {
    const attrs = this.getJsxAttrs(node, sourceFile);

    if (node.tagName.getText(sourceFile) === 'form') {
      return 'Submit';
    }

    // 1. Explicit human-authored aria-label
    if (attrs['aria-label'] && !attrs['aria-label'].includes('${')) {
      const clean = cleanSelectorToLabel(attrs['aria-label']);
      if (clean) return clean;
    }

    // 2. Visible child JSX text (e.g. <button>+ Add Tag</button>)
    const parent = node.parent;
    if (ts.isJsxElement(parent)) {
      const text = parent.children
        .map((c) => {
          if (ts.isJsxText(c)) return c.getText(sourceFile).trim();
          if (ts.isJsxElement(c)) {
            return c.children
              .map((cc) => (ts.isJsxText(cc) ? cc.getText(sourceFile).trim() : ''))
              .join(' ');
          }
          return '';
        })
        .join(' ')
        .trim();
      if (text && text.length > 1 && text.length < 40) {
        const clean = cleanLabelText(text);
        if (clean) return clean;
      }
    }

    // 3. Placeholder for input fields
    if (attrs['placeholder']) {
      const clean = cleanSelectorToLabel(attrs['placeholder']);
      if (clean) return clean;
    }

    // 4. Fallback to data-testid, sanitized to remove template interpolations and code noise
    if (attrs['data-testid']) {
      const clean = cleanSelectorToLabel(attrs['data-testid']);
      if (clean) return clean;
    }

    return node.tagName.getText(sourceFile);
  }

  private inferActionType(
    eventAttr: string,
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
  ): GraphEdgeAction['type'] {
    if (eventAttr === 'onSubmit') return 'submit';
    if (eventAttr === 'onChange') {
      const tag = node.tagName.getText(sourceFile);
      if (tag === 'select') return 'select';
      if (tag === 'input' || tag === 'textarea') return 'fill';
    }
    return 'click';
  }

  private getJsxAttrs(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
  ): Record<string, string> {
    const attrs: Record<string, string> = {};
    node.attributes.properties.forEach((prop) => {
      if (ts.isJsxAttribute(prop) && prop.initializer) {
        const name = prop.name.getText(sourceFile);
        const val = prop.initializer.getText(sourceFile).replace(/^["'`{]|["'`}]$/g, '').trim();
        attrs[name] = val;
      }
    });
    return attrs;
  }

  // ─── Playwright Code Generation ───────────────────────────────────────────

  private generatePlaywrightCode(
    stateNode: StateNode,
    trigger: { selector: string; label: string; actionType: GraphEdgeAction['type'] },
    newValue: string
  ): string {
    const sel = trigger.selector;

    // The actual detected trigger action always wins over a kind-based
    // default: a state can be set by a plain input's onChange (fill) or by
    // a button that sets a hardcoded value (click) — e.g. a "fill demo
    // credentials" button also calls setEmail(...), but it's a click, not
    // a fill, regardless of what kind the *state* was classified as.
    if (trigger.actionType === 'fill') {
      const fillValue = stateNode.kind === 'filter' ? 'search term' : 'sample value';
      return `await page.fill('${sel}', '${fillValue}');`;
    }
    if (trigger.actionType === 'select') {
      const optionValue = stateNode.initialValue?.replace(/['"]/g, '') || 'Infrastructure';
      return `await page.selectOption('${sel}', '${optionValue}');`;
    }
    if (trigger.actionType === 'submit') {
      return `await page.locator('${sel}').evaluate((f) => (f as HTMLFormElement).requestSubmit());`;
    }

    if (stateNode.kind === 'modal') {
      if (newValue === 'false' || newValue.includes('false')) {
        return `await page.click('${sel}');\nawait expect(page.locator('[role="dialog"], .fixed.inset-0')).not.toBeVisible();`;
      }
      return `await page.click('${sel}');\nawait expect(page.locator('[role="dialog"], .fixed.inset-0')).toBeVisible();`;
    }
    return `await page.click('${sel}');`;
  }

  // ─── Form submission detection ────────────────────────────────────────────

  /**
   * Detect <form onSubmit={...}> elements and synthesize one submit edge per
   * form, keyed by the same formGroupId used to cluster its sibling fields.
   * This is what lets a composite form workflow actually complete the flow
   * (fill fields → submit) instead of stopping after the last fill.
   *
   * Also registers a minimal StateNode for each formGroupId so the submit
   * edge's sourceStateId/targetStateId resolves to a real, validated node —
   * previously this was a bare synthetic id (`form_<AST offset>`) that was
   * never added to either graph.nodes or graph.stateNodes, so every
   * in-place form submission (anything that doesn't navigate elsewhere,
   * e.g. adding a comment or saving settings) produced a dangling edge:
   * a graph node the walker/verifier could never actually act on.
   */
  private detectFormSubmissions(
    sourceFile: ts.SourceFile,
    componentName: string,
    parentRouteNodeId: string
  ): { stateNodes: StateNode[]; stateEdges: StateTransitionEdge[] } {
    const stateNodes: StateNode[] = [];
    const stateEdges: StateTransitionEdge[] = [];
    let formIndex = 0;

    const walk = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(sourceFile) === 'form') {
        const attrs = this.getJsxAttrs(node, sourceFile);
        const idx = formIndex++;

        if (attrs['onSubmit']) {
          const formGroupId = `form_${node.getStart(sourceFile)}`;
          // CSS `:nth-of-type(N)` counts siblings under the SAME parent —
          // it silently matches nothing when the Nth <form> in document
          // order isn't a DOM sibling of the others (e.g. one form lives
          // in a comment box, another appears later inside a details
          // panel). Playwright's own `:nth-match(selector, N)` counts
          // across the whole page in document order instead, which is
          // what `idx` (from a straight top-down AST walk) actually means.
          const defaultSelector = `:nth-match(form, ${idx + 1})`;
          let submitSelector = defaultSelector;
          let submitLabel = 'Submit';
          let isClickAction = false;

          // Look for an explicit submit button inside the form
          if (ts.isJsxElement(node.parent)) {
            const findSubmitBtn = (child: ts.Node): void => {
              if (submitSelector !== defaultSelector) return;
              if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
                if (child.tagName.getText(sourceFile) === 'button') {
                  const bAttrs = this.getJsxAttrs(child, sourceFile);
                  const isSubmit = bAttrs['type'] === 'submit' || (!bAttrs['type'] && !bAttrs['onClick']);
                  if (isSubmit) {
                    const testId = bAttrs['data-testid'];
                    if (testId && !testId.includes('${')) {
                      submitSelector = `button[data-testid="${testId}"]`;
                    } else {
                      submitSelector = this.extractSelector(child, sourceFile) || defaultSelector;
                    }
                    submitLabel = this.extractLabel(child, sourceFile) || 'Submit';
                    isClickAction = true;
                  }
                }
              }
              ts.forEachChild(child, findSubmitBtn);
            };
            findSubmitBtn(node.parent);
          }

          const actionType: ActionType = isClickAction ? 'click' : 'submit';

          stateNodes.push({
            id: formGroupId,
            kind: 'form_group',
            parentRouteNodeId,
            stateName: `form_${idx}`,
            setterName: '',
            initialValue: '',
            sourceFile: path.basename(sourceFile.fileName),
            formGroupId,
          });

          stateEdges.push({
            id: `form_submit_${componentName}_${node.getStart(sourceFile)}`,
            sourceStateId: formGroupId,
            targetStateId: formGroupId,
            triggerSelector: submitSelector,
            triggerLabel: submitLabel,
            action: { type: actionType, targetSelector: submitSelector, targetLabel: submitLabel },
            narration: submitLabel !== 'Submit' ? `Click ${submitLabel} to confirm and save your changes.` : 'Submit the form to confirm and save your changes.',
            playwrightCode: isClickAction
              ? `await page.click('${submitSelector}');`
              : `await page.locator('${submitSelector}').evaluate((f) => (f as HTMLFormElement).requestSubmit());`,
          });
        }
      }

      ts.forEachChild(node, walk);
    };

    walk(sourceFile);
    return { stateNodes, stateEdges };
  }

  // ─── Cross-component mounting detection ──────────────────────────────────

  private detectCrossComponentMounting(
    stateNodes: StateNode[],
    sourceFile: ts.SourceFile,
    sourceText: string,
    parentRouteNodeId: string,
    componentName: string
  ): StateTransitionEdge[] {
    const edges: StateTransitionEdge[] = [];

    for (const sn of stateNodes) {
      if (sn.kind !== 'modal' && sn.kind !== 'toggle') continue;

      const pattern = new RegExp(`\\{${sn.stateName}\\s*&&\\s*<([A-Z][a-zA-Z0-9_]*)`, 'g');
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sourceText)) !== null) {
        const mountedComponent = match[1];
        const edgeId = `cross_mount_${componentName}_${sn.stateName}_${mountedComponent}`;
        edges.push({
          id: edgeId,
          sourceStateId: parentRouteNodeId,
          targetStateId: `component_${mountedComponent}`,
          triggerSelector: `[data-testid*="${sn.stateName.toLowerCase()}"], button:has-text("${mountedComponent}")`,
          triggerLabel: `Open ${mountedComponent}`,
          action: { type: 'click', targetSelector: '', targetLabel: `Mount ${mountedComponent}` },
          narration: `Click to open the ${cleanSelectorToLabel(mountedComponent) || mountedComponent} view.`,
          playwrightCode: `// ${mountedComponent} mounted when ${sn.stateName} is truthy`,
          branchCondition: sn.branchCondition,
        });
      }
    }

    return edges;
  }

  // ─── File collection ──────────────────────────────────────────────────────

  private collectSourceFiles(dir: string): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
        results = results.concat(this.collectSourceFiles(full));
      } else if (entry.isFile() && /\.(tsx|jsx|ts|js)$/.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }
}
