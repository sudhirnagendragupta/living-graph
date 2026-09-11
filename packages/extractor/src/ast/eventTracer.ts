import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { GraphEdge, GraphNode, GraphEdgeAction } from '../types.js';
import { DiscoveredRoute } from './routerScanner.js';
import { StateNode, StateTransitionEdge } from '../types.js';
import { formatSemanticNarration, cleanSelectorToLabel, cleanLabelText } from '../semanticNarration.js';

/**
 * EventTracer replaces NavigationTracer entirely.
 *
 * Produces a unified edge set covering:
 *   1. URL navigation edges — navigate(), <Link>, <NavLink>, <a href>
 *   2. Intra-page state transition edges — promoted from StateScanner output
 *
 * No hardcoded node IDs. No version field. Branch conditions are captured
 * from conditional rendering context as raw expression strings.
 */
export class EventTracer {
  /**
   * Trace all URL navigation edges from component source files.
   */
  public traceNavigationEdges(
    nodes: Record<string, GraphNode>,
    routes: DiscoveredRoute[]
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const routePathToNodeId = new Map(routes.map((r) => [r.path, r.nodeId]));

    for (const route of routes) {
      if (!route.componentFilePath || !fs.existsSync(route.componentFilePath)) continue;

      const sourceText = fs.readFileSync(route.componentFilePath, 'utf-8');
      if (!sourceText.includes('navigate(') && !sourceText.includes('<Link') && !sourceText.includes('<NavLink')) {
        continue;
      }

      const sourceFile = ts.createSourceFile(
        path.basename(route.componentFilePath),
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );

      const componentEdges = this.extractNavigationEdges(
        sourceFile,
        route.nodeId,
        nodes,
        routePathToNodeId
      );
      edges.push(...componentEdges);
    }

    return this.deduplicateEdges(edges);
  }

  /**
   * Promote StateTransitionEdges into the unified GraphEdge format
   * so they appear in the same edge list as URL transitions.
   */
  public promoteStateEdges(stateEdges: StateTransitionEdge[]): GraphEdge[] {
    return stateEdges.map((se) => ({
      id: se.id,
      sourceNodeId: se.sourceStateId,
      targetNodeId: se.targetStateId,
      action: se.action,
      narration: se.narration,
      playwrightCode: se.playwrightCode,
      branchCondition: se.branchCondition,
    }));
  }

  // ─── URL Navigation Edge Extraction ───────────────────────────────────────

  private extractNavigationEdges(
    sourceFile: ts.SourceFile,
    sourceNodeId: string,
    nodes: Record<string, GraphNode>,
    routePathToNodeId: Map<string, string>
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const edgeIndex = { count: 0 };

    const walk = (node: ts.Node, branchCondition?: string): void => {
      let currentBranch = branchCondition;

      // Detect feature-flag branch
      if (ts.isConditionalExpression(node)) {
        const condText = node.condition.getText(sourceFile).trim();
        if (this.isFeatureFlagCondition(condText)) {
          walk(node.whenTrue, condText);
          walk(node.whenFalse, `!(${condText})`);
          return;
        }
      }

      // 1. navigate('/path') call
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'navigate' &&
        node.arguments.length > 0
      ) {
        const targetPath = this.extractStringArg(node.arguments[0], sourceFile);
        if (targetPath) {
          const targetNodeId = this.resolveTargetNode(targetPath, routePathToNodeId, nodes);
          if (targetNodeId && targetNodeId !== sourceNodeId) {
            const trigger = this.findTriggerForCall(node, sourceFile);
            if (trigger) {
              edges.push(this.buildNavigationEdge(
                `nav_${sourceNodeId}_to_${targetNodeId}_${edgeIndex.count++}`,
                sourceNodeId,
                targetNodeId,
                trigger,
                targetPath,
                currentBranch
              ));
            }
          }
        }
      }

      // 2. <Link to="/path"> or <NavLink to="/path">
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        if (tagName === 'Link' || tagName === 'NavLink') {
          const attrs = this.getJsxAttrs(node, sourceFile);
          const to = attrs['to'];
          if (to) {
            const targetNodeId = this.resolveTargetNode(to, routePathToNodeId, nodes);
            if (targetNodeId && targetNodeId !== sourceNodeId) {
              const selector = this.extractSelector(node, sourceFile) ?? `a[href="${to}"]`;
              const label = this.extractLabel(node, sourceFile);
              edges.push(this.buildNavigationEdge(
                `link_${sourceNodeId}_to_${targetNodeId}_${edgeIndex.count++}`,
                sourceNodeId,
                targetNodeId,
                { selector, label, actionType: 'click' },
                to,
                currentBranch
              ));
            }
          }
        }
      }

      ts.forEachChild(node, (child) => walk(child, currentBranch));
    };

    walk(sourceFile);
    return edges;
  }

  private buildNavigationEdge(
    id: string,
    sourceNodeId: string,
    targetNodeId: string,
    trigger: { selector: string; label: string; actionType: GraphEdgeAction['type'] },
    targetPath: string,
    branchCondition?: string
  ): GraphEdge {
    const urlPattern = targetPath.replace(/:[a-zA-Z0-9_]+/g, '[a-zA-Z0-9_-]+');
    return {
      id,
      sourceNodeId,
      targetNodeId,
      action: {
        type: trigger.actionType,
        targetSelector: trigger.selector,
        targetLabel: trigger.label,
      },
      narration: formatSemanticNarration(trigger.actionType, trigger.label, trigger.selector, id),
      playwrightCode: `await page.click('${trigger.selector}');\nawait expect(page).toHaveURL(/${urlPattern.replace('/', '\/')}/);`,
      branchCondition,
    };
  }

  // ─── Path resolution ──────────────────────────────────────────────────────

  private resolveTargetNode(
    targetPath: string,
    routePathToNodeId: Map<string, string>,
    nodes: Record<string, GraphNode>
  ): string | null {
    // Exact match first
    if (routePathToNodeId.has(targetPath)) {
      const id = routePathToNodeId.get(targetPath)!;
      return nodes[id] ? id : null;
    }

    // Dynamic path: /tickets/someId → match /tickets/:id
    for (const [routePath, nodeId] of routePathToNodeId) {
      const pattern = new RegExp('^' + routePath.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$');
      if (pattern.test(targetPath) && nodes[nodeId]) return nodeId;
    }

    // Template literal path: /tickets/${id} → match /tickets/:id
    const templateBase = targetPath.split('${')[0].replace(/\/$/, '');
    for (const [routePath, nodeId] of routePathToNodeId) {
      if (routePath.startsWith(templateBase) && nodes[nodeId]) return nodeId;
    }

    return null;
  }

  // ─── Trigger element detection ────────────────────────────────────────────

  /**
   * Find the JSX element responsible for triggering this navigate() call.
   * Handles both an inline JSX handler (`onClick={() => navigate(...)}`) and
   * a named handler function referenced elsewhere as `onClick={handleGo}` —
   * the latter is invisible to a pure ancestor climb from the call site.
   */
  private findTriggerForCall(
    callNode: ts.Node,
    sourceFile: ts.SourceFile
  ): { selector: string; label: string; actionType: GraphEdgeAction['type'] } | null {
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
  ): { selector: string; label: string; actionType: GraphEdgeAction['type'] } | null {
    let current: ts.Node = callNode;
    let depth = 0;

    while (current.parent && depth < 12) {
      current = current.parent;
      depth++;

      if (ts.isJsxAttribute(current)) {
        const attrName = current.name.getText(sourceFile);
        if (!['onClick', 'onSubmit', 'onChange', 'onKeyDown'].includes(attrName)) continue;

        const jsxElement = current.parent?.parent;
        if (!jsxElement) continue;
        if (!ts.isJsxOpeningElement(jsxElement) && !ts.isJsxSelfClosingElement(jsxElement)) continue;

        const selector = this.extractSelector(jsxElement, sourceFile);
        if (!selector) continue;

        const label = this.extractLabel(jsxElement, sourceFile);
        const actionType: GraphEdgeAction['type'] = attrName === 'onSubmit' ? 'submit' : 'click';
        return { selector, label, actionType };
      }
    }

    return null;
  }

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
  ): { selector: string; label: string; actionType: GraphEdgeAction['type'] } | null {
    const escaped = handlerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const refPattern = new RegExp(`\\{\\s*${escaped}\\s*\\}|\\b${escaped}\\s*\\(`);
    let result: { selector: string; label: string; actionType: GraphEdgeAction['type'] } | null = null;

    const walk = (node: ts.Node): void => {
      if (result) return;

      if (ts.isJsxAttribute(node) && node.initializer) {
        const attrName = node.name.getText(sourceFile);
        if (['onClick', 'onSubmit', 'onChange', 'onKeyDown'].includes(attrName)) {
          const initText = node.initializer.getText(sourceFile);
          if (refPattern.test(initText)) {
            const jsxElement = node.parent?.parent;
            if (jsxElement && (ts.isJsxOpeningElement(jsxElement) || ts.isJsxSelfClosingElement(jsxElement))) {
              const selector = this.extractSelector(jsxElement, sourceFile);
              if (selector) {
                const actionType: GraphEdgeAction['type'] = attrName === 'onSubmit' ? 'submit' : 'click';
                result = { selector, label: this.extractLabel(jsxElement, sourceFile), actionType };
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

  // ─── Shared JSX helpers ───────────────────────────────────────────────────

  private extractSelector(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
  ): string | null {
    const attrs = this.getJsxAttrs(node, sourceFile);
    const tag = node.tagName.getText(sourceFile);

    const testId = attrs['data-testid'];
    if (testId && !testId.includes('${')) return `${tag}[data-testid="${testId}"]`;

    const ariaLabel = attrs['aria-label'];
    if (ariaLabel && !ariaLabel.includes('${')) return `${tag}[aria-label="${ariaLabel}"]`;

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
      // Split on the interpolation marker itself, not a bare '$' — a
      // static prefix containing a literal '$' (e.g. "price-$5-row-${id}")
      // would otherwise get truncated too early.
      const prefix = testId.split('${')[0];
      return `${tag}[data-testid^="${prefix}"]`;
    }

    if (tag === 'form') {
      const parent = node.parent;
      if (ts.isJsxElement(parent)) {
        let submitBtnSelector: string | null = null;
        const findButton = (child: ts.Node): void => {
          if (submitBtnSelector) return;
          if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
            const childTag = child.tagName.getText(sourceFile);
            if (childTag === 'button') {
              const childAttrs = this.getJsxAttrs(child, sourceFile);
              if (childAttrs['type'] === 'submit' || !childAttrs['type']) {
                if (childAttrs['data-testid']) {
                  submitBtnSelector = `button[data-testid="${childAttrs['data-testid']}"]`;
                } else {
                  submitBtnSelector = `button[type="submit"]`;
                }
              }
            }
          }
          ts.forEachChild(child, findButton);
        };
        findButton(parent);
        if (submitBtnSelector) return submitBtnSelector;
      }
      return 'form';
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

    // 2. Visible child JSX text (e.g. <button>View Tickets</button>, <a>Details</a>)
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

  private getJsxAttrs(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
  ): Record<string, string> {
    const attrs: Record<string, string> = {};
    node.attributes.properties.forEach((prop) => {
      if (ts.isJsxAttribute(prop) && prop.initializer) {
        const name = prop.name.getText(sourceFile);
        let raw = prop.initializer.getText(sourceFile);
        // Strip only the true outer wrapper layer(s) — the JSX expression
        // container `{...}`, then (if what's left is a fully quoted/
        // templated string) its outer quote/backtick pair — rather than
        // stripping every quote/brace character anywhere in the string.
        // The previous single-pass `^["'`{]|["'`}]$` regex only removed one
        // leading and one trailing character each, so for
        // `data-testid={`ticket-row-${id}`}` it stripped the outer `{`/`}`
        // but left the inner backticks in place, producing a selector with
        // a literal backtick baked into it. Worse, a version of this that
        // strips ALL such characters unconditionally also destroys the
        // `${` marker this file later checks for to detect a *dynamic*
        // testid — so that detection has to run on properly-unwrapped text
        // that still has its interpolation markers intact.
        if (raw.startsWith('{') && raw.endsWith('}')) raw = raw.slice(1, -1);
        if (raw.length >= 2 && /^["'`]/.test(raw) && raw.endsWith(raw[0])) raw = raw.slice(1, -1);
        attrs[name] = raw.trim();
      }
    });
    return attrs;
  }

  private extractStringArg(node: ts.Node, sourceFile: ts.SourceFile): string | null {
    const text = node.getText(sourceFile).trim();
    const match = text.match(/^['"`]([^'"`]+)['"`]$/);
    return match ? match[1] : null;
  }

  private isFeatureFlagCondition(condText: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*\(/.test(condText) ||
      /^[A-Z_][A-Z0-9_]+$/.test(condText) ||
      condText.includes('process.env.') ||
      condText.includes('import.meta.env.');
  }

  private deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
    const seen = new Set<string>();
    return edges.filter((e) => {
      const key = `${e.sourceNodeId}→${e.targetNodeId}→${e.action.targetSelector}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
