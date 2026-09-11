import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { IVerifierClient } from '@living-graph/verifier';
import { GraphEdge, ActionType } from '@living-graph/extractor';
import { extractLiteralValue, inferFillValue } from './fillValueHeuristics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface HealedStepResult {
  originalEdge: GraphEdge;
  healedSelector: string;
  /**
   * The VLM only ever reports 'click'|'fill'|'select' (see relocateAction's
   * prompt) — 'navigate'/'submit'/'keydown' can still appear here because
   * this falls back to the ORIGINAL edge's action type when the VLM omits
   * actionType, and the original edge can be any ActionType.
   */
  healedActionType: ActionType;
  /** Populated only when healedActionType is 'fill'/'select' — the value walker.ts should actually enter. */
  suggestedValue?: string;
  healedPlaywrightCode: string;
  reasoning: string;
}

export class AutonomousHealer {
  private verifier: IVerifierClient;

  constructor(verifier: IVerifierClient) {
    this.verifier = verifier;
  }

  /**
   * Attempt autonomous self-healing when an action target is not found in the DOM.
   */
  public async healBrokenEdge(page: Page, edge: GraphEdge): Promise<HealedStepResult> {
    console.log(`\n[SELF-HEALING] Action target missing: "${edge.action.targetSelector}". Capturing screenshot for VLM relocation...`);

    // Diagnostic dump — what the healer actually saw. Previously this
    // screenshot went straight into the VLM call and was discarded, so a
    // "VLM could not find a replacement" failure was indistinguishable from
    // "the page genuinely didn't have this button", "we're on the wrong
    // page entirely", or "the verifier call itself errored". Persist it and
    // print URL/body text so that's diagnosable from console output alone.
    const debugDir = path.resolve(__dirname, '../output/debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    const debugShotPath = path.join(debugDir, `healing_${edge.id}_${Date.now()}.png`);

    const screenshotBuffer = await page.screenshot({ fullPage: false, path: debugShotPath });
    const screenshotBase64 = screenshotBuffer.toString('base64');
    const bodyText = await page.locator('body').innerText().catch((e) => `(failed to read body: ${e.message})`);

    console.log(`  [DIAGNOSTIC] Page URL at failure: ${page.url()}`);
    console.log(`  [DIAGNOSTIC] Screenshot saved -> ${debugShotPath}`);
    console.log(`  [DIAGNOSTIC] Visible body text (first 400 chars): ${bodyText.slice(0, 400).replace(/\n+/g, ' | ')}`);

    // Query VLM (NVIDIA NIM / Mock) to locate where the feature relocated
    const relocation = await this.verifier.relocateAction({
      screenshotBase64,
      missingElementDescription: edge.action.targetLabel || edge.action.targetSelector,
      intent: edge.narration,
    });

    if (!relocation.found || !relocation.selector) {
      throw new Error(
        `[SELF-HEALING FAILED] VLM could not find a replacement for: ${edge.action.targetSelector} (reasoning: ${relocation.reasoning || '(none given)'})`
      );
    }

    console.log(`[SELF-HEALING SUCCESS] VLM located replacement control: "${relocation.selector}" (${relocation.label})`);
    console.log(`[SELF-HEALING REASONING] ${relocation.reasoning}`);

    // A relocated element keeps its original action type the vast majority
    // of the time (a fill target that moved is still a fill target) — only
    // override when the VLM explicitly reports a different one (the
    // control's actual role genuinely changed in the redesign, e.g. a
    // dropdown became a set of toggle buttons). Previously this was
    // unconditionally hardcoded to 'click', so a relocated text input got
    // clicked (focused, never filled) instead of filled.
    const healedActionType = relocation.actionType || edge.action.type;
    const comment = `// [HEALED by VLM]: Replaced "${edge.action.targetSelector}" -> "${relocation.selector}"`;

    let healedPlaywrightCode: string;
    let suggestedValue: string | undefined;

    if (healedActionType === 'fill') {
      const literal = extractLiteralValue(edge.action.payload?.value);
      suggestedValue = literal ?? relocation.suggestedValue ?? inferFillValue(relocation.selector, edge.narration);
      healedPlaywrightCode = `${comment}\nawait page.fill('${relocation.selector}', '${suggestedValue.replace(/'/g, "\\'")}');`;
    } else if (healedActionType === 'select') {
      const literal =
        extractLiteralValue(edge.action.payload?.status) ?? extractLiteralValue(edge.action.payload?.value);
      suggestedValue = literal ?? relocation.suggestedValue;
      healedPlaywrightCode = suggestedValue
        ? `${comment}\nawait page.selectOption('${relocation.selector}', '${suggestedValue.replace(/'/g, "\\'")}');`
        : `${comment}\nawait page.click('${relocation.selector}');`;
    } else {
      healedPlaywrightCode = `${comment}\nawait page.click('${relocation.selector}');`;
    }

    return {
      originalEdge: edge,
      healedSelector: relocation.selector,
      healedActionType,
      suggestedValue,
      healedPlaywrightCode,
      reasoning: relocation.reasoning,
    };
  }
}
