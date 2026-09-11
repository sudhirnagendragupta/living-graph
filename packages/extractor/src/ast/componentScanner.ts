import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { InteractiveElement } from '../types.js';
import { cleanSelectorToLabel, cleanLabelText } from '../semanticNarration.js';

export interface ComponentInspectionResult {
  title?: string;
  description?: string;
  interactiveElements: InteractiveElement[];
  hasMultiStepWizard?: boolean;
  wizardSteps?: { num: number; label: string; branchCondition?: string }[];
  navigationCalls: { targetUrl: string; triggerSelector: string; branchCondition?: string }[];
}

/**
 * Scans React/TSX component files via AST to discover interactive elements,
 * screen headings, and navigation triggers.
 *
 * Codebase-agnostic: does not hardcode component or app-specific logic.
 */
export class ComponentScanner {
  /**
   * Inspect component file and extract interactive elements, heading metadata, and navigations.
   */
  public inspectComponent(filePath: string): ComponentInspectionResult {
    if (!fs.existsSync(filePath)) {
      return { interactiveElements: [], navigationCalls: [] };
    }

    const sourceText = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    let title: string | undefined;
    let description: string | undefined;
    const interactiveElements: InteractiveElement[] = [];
    const navigationCalls: { targetUrl: string; triggerSelector: string; branchCondition?: string }[] = [];

    // Check for multi-step wizard pattern
    const wizardInfo = this.detectWizardPattern(sourceFile);

    const walk = (node: ts.Node, currentBranchContext?: string) => {
      let branchContext = currentBranchContext;

      // 1. Detect branch contexts (ternaries, conditionals, logical AND feature flags)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        const leftText = node.left.getText(sourceFile).trim();
        if (this.isBranchCondition(leftText)) {
          branchContext = leftText;
        }
      } else if (ts.isConditionalExpression(node)) {
        const condText = node.condition.getText(sourceFile).trim();
        if (this.isBranchCondition(condText)) {
          walk(node.whenTrue, condText);
          walk(node.whenFalse, `!(${condText})`);
          return;
        }
      }

      // 2. Detect Heading text for screen title
      if (!title && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
        const tagName = node.tagName.getText(sourceFile);
        if (tagName === 'h1' || tagName === 'h2') {
          const parent = node.parent;
          if (ts.isJsxElement(parent)) {
            const headingText = parent.children
              .map((c) => (ts.isJsxText(c) ? c.getText(sourceFile).trim() : ''))
              .join(' ')
              .trim();
            if (headingText && headingText.length > 2 && !headingText.includes('{')) {
              title = headingText;
            }
          }
        }
      }

      // 3. Detect Interactive JSX elements
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        const isInteractiveTag = ['button', 'input', 'select', 'textarea', 'a'].includes(tagName);

        const attrs = this.extractAttributes(node, sourceFile);
        const hasHandler = Boolean(attrs['onClick'] || attrs['onChange'] || attrs['onSubmit']);

        if (isInteractiveTag || hasHandler) {
          const elem = this.buildInteractiveElement(tagName, attrs, node, sourceFile, branchContext);
          if (elem) {
            interactiveElements.push(elem);

            // Check if element triggers navigation: e.g. onClick={() => navigate('/...')}
            if (attrs['onClick'] && attrs['onClick'].includes('navigate(')) {
              const navMatch = attrs['onClick'].match(/navigate\(\s*['"`]([^'"`]+)['"`]\s*\)/);
              if (navMatch && navMatch[1]) {
                navigationCalls.push({
                  targetUrl: navMatch[1],
                  triggerSelector: elem.selector,
                  branchCondition: elem.branchCondition,
                });
              }
            }
          }
        }
      }

      ts.forEachChild(node, (child) => walk(child, branchContext));
    };

    walk(sourceFile);

    return {
      title,
      description,
      interactiveElements,
      hasMultiStepWizard: wizardInfo.hasWizard,
      wizardSteps: wizardInfo.steps,
      navigationCalls,
    };
  }

  private isBranchCondition(condText: string): boolean {
    return (
      /^[a-zA-Z_$][a-zA-Z0-9_$]*\(/.test(condText) ||
      /^[A-Z_][A-Z0-9_]+$/.test(condText) ||
      condText.includes('process.env.') ||
      condText.includes('import.meta.env.')
    );
  }

  private extractAttributes(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
  ): Record<string, string> {
    const attrs: Record<string, string> = {};
    node.attributes.properties.forEach((prop) => {
      if (ts.isJsxAttribute(prop) && prop.initializer) {
        attrs[prop.name.getText(sourceFile)] = prop.initializer.getText(sourceFile);
      }
    });
    return attrs;
  }

  private buildInteractiveElement(
    tagName: string,
    attrs: Record<string, string>,
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile,
    branchCondition?: string
  ): InteractiveElement | null {
    // Strip only the true outer wrapper layer(s) — the JSX expression
    // container `{...}`, then (if what's left is a fully quoted/templated
    // string) its outer quote/backtick pair — not every quote/brace
    // character anywhere in the value. Blanket-stripping (the previous
    // behavior) also destroys the `${` interpolation marker the dynamic-
    // testid check below depends on, and for a value like
    // `ticket-row-${ticket.id}` leaves a mangled `ticket-row-$ticket.id`
    // that then wrongly takes the exact-match branch instead of the
    // dynamic-prefix one.
    let rawTestId = attrs['data-testid'] || null;
    if (rawTestId) {
      if (rawTestId.startsWith('{') && rawTestId.endsWith('}')) rawTestId = rawTestId.slice(1, -1);
      if (rawTestId.length >= 2 && /^["'`]/.test(rawTestId) && rawTestId.endsWith(rawTestId[0])) {
        rawTestId = rawTestId.slice(1, -1);
      }
    }
    const testId = rawTestId ? rawTestId.trim() : null;
    const idAttr = attrs['id'] ? attrs['id'].replace(/['"]/g, '') : null;
    const typeAttr = attrs['type'] ? attrs['type'].replace(/['"]/g, '') : null;
    const placeholder = attrs['placeholder'] ? attrs['placeholder'].replace(/['"]/g, '') : null;
    const ariaLabel = attrs['aria-label'] ? attrs['aria-label'].replace(/['"]/g, '') : null;

    // Extract text children if button or a
    let textContent = '';
    if (node.parent && ts.isJsxElement(node.parent)) {
      textContent = node.parent.children
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
    }

    // Role inference
    let role: InteractiveElement['role'] = 'button';
    if (tagName === 'input') {
      role = typeAttr === 'checkbox' ? 'checkbox' : 'input';
    } else if (tagName === 'textarea') {
      role = 'textbox';
    } else if (tagName === 'select') {
      role = 'select';
    } else if (tagName === 'a') {
      role = 'link';
    } else if (attrs['role']) {
      const customRole = attrs['role'].replace(/['"]/g, '');
      if (['button', 'input', 'select', 'link', 'tab', 'checkbox', 'textbox'].includes(customRole)) {
        role = customRole as any;
      }
    }

    // Selector generation (aria-label included)
    let selector = '';
    if (testId && !testId.includes('${')) {
      selector = `${tagName}[data-testid="${testId}"]`;
    } else if (idAttr) {
      selector = `${tagName}#${idAttr}`;
    } else if (ariaLabel && !ariaLabel.includes('${')) {
      selector = `${tagName}[aria-label="${ariaLabel}"]`;
    } else if (placeholder) {
      selector = `${tagName}[placeholder*="${placeholder.slice(0, 20)}"]`;
    } else if (textContent && textContent.length > 1 && textContent.length < 35) {
      selector = `${tagName}:has-text("${textContent}")`;
    } else if (testId && testId.includes('${')) {
      // Split on the interpolation marker itself, not a bare '$' — a
      // static prefix containing a literal '$' would otherwise truncate
      // too early.
      const basePrefix = testId.split('${')[0];
      selector = `${tagName}[data-testid^="${basePrefix}"]`;
    } else {
      return null;
    }

    const rawLabel = ariaLabel || textContent || placeholder || idAttr || testId || tagName;
    const label = cleanSelectorToLabel(rawLabel) || tagName;
    const cleanId = (testId ? testId.replace(/\$\{[^}]*\}/g, '').replace(/[-_]+$/, '') : null) || idAttr || `${tagName}_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const id = cleanId.slice(0, 40);

    return {
      id,
      role,
      label,
      selector,
      branchCondition,
    };
  }

  private detectWizardPattern(
    sourceFile: ts.SourceFile
  ): { hasWizard: boolean; steps: { num: number; label: string; branchCondition?: string }[] } {
    const sourceText = sourceFile.getFullText();
    const hasCurrentStep = (sourceText.includes('currentStep') || sourceText.includes('step')) &&
      (sourceText.includes('setCurrentStep') || sourceText.includes('setStep'));
    if (!hasCurrentStep) {
      return { hasWizard: false, steps: [] };
    }

    // Dynamic extraction of step labels if defined in an array in the AST
    const steps: { num: number; label: string; branchCondition?: string }[] = [];
    let stepNum = 1;

    // Search for array definitions like `steps = [...]` or `STEPS = [...]`
    const walk = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /steps?/i.test(node.name.text) &&
        node.initializer
      ) {
        let arrayExpr: ts.ArrayLiteralExpression | null = null;
        if (ts.isArrayLiteralExpression(node.initializer)) {
          arrayExpr = node.initializer;
        } else if (ts.isConditionalExpression(node.initializer)) {
          // If conditional e.g. cond ? [...] : [...]
          if (ts.isArrayLiteralExpression(node.initializer.whenTrue)) {
            arrayExpr = node.initializer.whenTrue;
          }
        }

        if (arrayExpr) {
          arrayExpr.elements.forEach((elem) => {
            if (ts.isStringLiteral(elem)) {
              steps.push({ num: stepNum++, label: elem.text });
            } else if (ts.isObjectLiteralExpression(elem)) {
              const labelProp = elem.properties.find(
                (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && /label|name|title/i.test(p.name.text)
              ) as ts.PropertyAssignment | undefined;
              if (labelProp && ts.isStringLiteral(labelProp.initializer)) {
                steps.push({ num: stepNum++, label: labelProp.initializer.text });
              }
            }
          });
        }
      }
      ts.forEachChild(node, walk);
    };

    walk(sourceFile);

    return { hasWizard: steps.length > 0 || hasCurrentStep, steps };
  }
}
