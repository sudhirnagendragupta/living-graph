import Anthropic from '@anthropic-ai/sdk';
import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VIEWPORT = { width: 1280, height: 800 };

export interface ComputerUseActionTrace {
  turnIndex: number;
  toolName: string;
  input: unknown;
  isError: boolean;
  note?: string;
  screenshotPath: string;
  /** The model's own one-sentence description of this action, captured from its turn text and reused as tutorial narration. */
  narration?: string;
  /** Best-effort CSS selector of the DOM element this action targeted, captured live from the page at execution time (not guessed after the fact). */
  selector?: string;
  /** A single generated Playwright statement replaying this action, built from `selector` when available. */
  playwrightCode?: string;
}

export interface ComputerUseWalkResult {
  goal: string;
  /** True only when the model stopped calling tools on its own, i.e. it believes the goal was reached. There is no dedicated "done" action in this tool family — this is a proxy, not a guarantee. */
  success: boolean;
  stopReason: 'model_stopped' | 'turn_budget_exhausted' | 'error';
  totalActions: number;
  traces: ComputerUseActionTrace[];
  /** The model's own final plain-text message — the actual signal for whether it thinks it succeeded, failed, or got stuck. */
  finalMessage: string;
}

/**
 * Maps the key names Claude's computer-use tool sends (xdotool/X11-style,
 * e.g. "Return", "BackSpace", "ctrl+a") to Playwright's key syntax
 * ("Enter", "Backspace", "Control+A"). Unrecognized single keys are passed
 * through as-is — Playwright accepts plain printable characters directly.
 */
function toPlaywrightKey(text: string): string {
  const KEY_MAP: Record<string, string> = {
    return: 'Enter',
    enter: 'Enter',
    kp_enter: 'Enter',
    escape: 'Escape',
    esc: 'Escape',
    backspace: 'Backspace',
    delete: 'Delete',
    tab: 'Tab',
    space: 'Space',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    home: 'Home',
    end: 'End',
    page_up: 'PageUp',
    page_down: 'PageDown',
    super: 'Meta',
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
  };

  return text
    .split('+')
    .map((part) => {
      const lower = part.trim().toLowerCase();
      if (KEY_MAP[lower]) return KEY_MAP[lower];
      if (part.length === 1) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('+');
}

/**
 * In-page selector builder injected via page.evaluate — mirrors the kind of
 * stable selector the extractor's static AST scan would have produced
 * (data-testid / id / aria-label first, falling back to a short CSS path),
 * so a captured element reads the same way whether it came from source
 * analysis or from watching a live click land on it.
 */
// `el` is typed `any` deliberately: this function's source is stringified
// via toString() and re-parsed inside the browser context by
// captureSelector below, so it never actually runs (or type-checks
// meaningfully) under this package's Node/DOM lib combination — only its
// text matters.
function buildSelectorInPage(el: any): string {
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;

  if (el.id) return `#${CSS.escape(el.id)}`;

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;

  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;

  // Short CSS path fallback: tag + nth-of-type chain, up to 4 ancestors.
  const parts: string[] = [];
  let node: any = el;
  for (let depth = 0; node && depth < 4; depth++) {
    let selector = node.tagName.toLowerCase();
    const parent: any = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c: any) => c.tagName === node.tagName);
      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
    }
    parts.unshift(selector);
    node = parent;
  }
  return parts.join(' > ');
}

/**
 * Drives the browser toward an open-ended goal using Claude's native
 * computer-use toolset (`computer_toolset_20260801`): the model sees a
 * screenshot, issues low-level UI actions (click/type/key/scroll/...) by
 * pixel coordinate in a real multi-turn tool-use loop, and we execute each
 * one directly via Playwright's mouse/keyboard APIs and report a fresh
 * screenshot back. There is no DOM inventory or index-based grounding here
 * — this is Claude's own trained interaction mode, not a custom scheme, so
 * coordinates go straight from the model to Playwright with no translation
 * layer beyond the key-name mapping above.
 *
 * This replaced an earlier numbered-DOM-element-index approach (pick an
 * element by number, execute via its handle). That worked but fought the
 * model's native training; this is a straight rewrite, not a variant kept
 * alongside it.
 */
export class ComputerUseWalker {
  private client: Anthropic;
  private model: string;
  private targetUrl: string;

  constructor(targetUrl: string = 'http://localhost:5173', options?: { apiKey?: string; model?: string; apiBaseUrl?: string }) {
    const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('[ComputerUseWalker] ANTHROPIC_API_KEY is not set. Export it (or set it in .env) to use the computer-use agentic walker.');
    }
    this.model = options?.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
    this.client = new Anthropic({ apiKey, baseURL: options?.apiBaseUrl || process.env.ANTHROPIC_BASE_URL });
    this.targetUrl = targetUrl.replace(/\/$/, '');
  }

  /**
   * Captures a selector for the element this action is about to target,
   * BEFORE the action runs — a click can navigate away or unmount the
   * element, so this only works if read ahead of execution. Coordinate
   * actions resolve via elementFromPoint; type/key act on whatever already
   * has focus, so those resolve via document.activeElement instead.
   */
  private async captureSelector(page: Page, name: string, input: any): Promise<string | undefined> {
    try {
      if (['left_click', 'right_click', 'middle_click', 'double_click', 'triple_click'].includes(name) && input?.coordinate) {
        const [x, y] = input.coordinate;
        return await page.evaluate(
          ([px, py, fnSrc]) => {
            const build = new Function('el', `return (${fnSrc})(el)`) as (el: Element) => string;
            const el = document.elementFromPoint(px as number, py as number);
            return el ? build(el) : undefined;
          },
          [x, y, buildSelectorInPage.toString()] as const
        );
      }
      if (name === 'type' || name === 'key') {
        return await page.evaluate((fnSrc) => {
          const build = new Function('el', `return (${fnSrc})(el)`) as (el: Element) => string;
          const el = document.activeElement;
          return el && el !== document.body ? build(el) : undefined;
        }, buildSelectorInPage.toString());
      }
    } catch {
      // Best-effort only — a missed selector still leaves the action itself intact.
    }
    return undefined;
  }

  private buildPlaywrightCode(name: string, input: any, selector?: string): string {
    switch (name) {
      case 'left_click':
      case 'double_click':
      case 'triple_click':
      case 'right_click':
      case 'middle_click': {
        const method = name === 'double_click' ? 'dblclick' : 'click';
        const opts =
          name === 'right_click' ? `, { button: 'right' }` : name === 'triple_click' ? `, { clickCount: 3 }` : '';
        return selector
          ? `await page.${method}('${selector}'${opts});`
          : `await page.mouse.click(${input?.coordinate?.[0]}, ${input?.coordinate?.[1]});`;
      }
      case 'type': {
        const text = String(input?.text ?? '').replace(/'/g, "\\'");
        return selector ? `await page.fill('${selector}', '${text}');` : `await page.keyboard.type('${text}');`;
      }
      case 'key':
        return `await page.keyboard.press('${toPlaywrightKey(input?.text ?? '')}');`;
      case 'scroll':
        return `await page.mouse.wheel(0, ${input?.scroll_direction === 'up' ? '-' : ''}${(input?.scroll_amount ?? 3) * 100});`;
      case 'wait':
        return `await page.waitForTimeout(${(input?.duration ?? 1) * 1000});`;
      default:
        return `// ${name}(${JSON.stringify(input)})`;
    }
  }

  private async executeAction(page: Page, name: string, input: any): Promise<{ isError?: boolean; note?: string }> {
    switch (name) {
      case 'screenshot':
        return {};

      case 'left_click':
        await page.mouse.click(input.coordinate[0], input.coordinate[1]);
        return {};
      case 'right_click':
        await page.mouse.click(input.coordinate[0], input.coordinate[1], { button: 'right' });
        return {};
      case 'middle_click':
        await page.mouse.click(input.coordinate[0], input.coordinate[1], { button: 'middle' });
        return {};
      case 'double_click':
        await page.mouse.dblclick(input.coordinate[0], input.coordinate[1]);
        return {};
      case 'triple_click':
        await page.mouse.click(input.coordinate[0], input.coordinate[1], { clickCount: 3 });
        return {};

      case 'mouse_move':
        await page.mouse.move(input.coordinate[0], input.coordinate[1]);
        return {};

      case 'left_click_drag': {
        const start = input.start_coordinate || input.coordinate;
        const end = input.start_coordinate ? input.coordinate : input.end_coordinate;
        if (!start || !end) return { isError: true, note: 'left_click_drag missing start/end coordinate' };
        await page.mouse.move(start[0], start[1]);
        await page.mouse.down();
        await page.mouse.move(end[0], end[1], { steps: 10 });
        await page.mouse.up();
        return {};
      }

      case 'type':
        await page.keyboard.type(input.text ?? '');
        return {};

      case 'key':
        await page.keyboard.press(toPlaywrightKey(input.text ?? ''));
        return {};

      case 'hold_key': {
        const key = toPlaywrightKey(input.text ?? '');
        await page.keyboard.down(key);
        await page.waitForTimeout((input.duration ?? 1) * 1000);
        await page.keyboard.up(key);
        return {};
      }

      case 'scroll': {
        const dx = input.scroll_direction === 'left' ? -1 : input.scroll_direction === 'right' ? 1 : 0;
        const dy = input.scroll_direction === 'up' ? -1 : input.scroll_direction === 'down' ? 1 : 0;
        const amount = (input.scroll_amount ?? 3) * 100;
        if (input.coordinate) await page.mouse.move(input.coordinate[0], input.coordinate[1]);
        await page.mouse.wheel(dx * amount, dy * amount);
        return {};
      }

      case 'wait':
        await page.waitForTimeout((input.duration ?? 1) * 1000);
        return {};

      case 'cursor_position':
        // Not tracked separately — Playwright doesn't expose real cursor
        // position, and this member is rarely load-bearing for a web walk.
        return { note: 'cursor_position is not tracked by this walker; treat as unavailable' };

      case 'zoom':
        // No real optical zoom/crop implemented — the model gets the same
        // full screenshot back, which is enough for the resolutions this
        // walker runs at.
        return {};

      default:
        return { isError: true, note: `Unsupported computer action: "${name}"` };
    }
  }

  public async walkGoal(
    goal: string,
    options?: { startPath?: string; maxTurns?: number; runId?: string }
  ): Promise<ComputerUseWalkResult> {
    const maxTurns = options?.maxTurns ?? 12;
    const runId = options?.runId ?? `computeruse_${Date.now()}`;
    const traceDir = path.resolve(__dirname, '../output/agentic', runId);
    fs.mkdirSync(traceDir, { recursive: true });

    const traces: ComputerUseActionTrace[] = [];
    let stopReason: ComputerUseWalkResult['stopReason'] = 'turn_budget_exhausted';
    let finalMessage = '';

    console.log(`\n======================================================`);
    console.log(` COMPUTER-USE WALKER (Claude native tool)`);
    console.log(` Goal: ${goal}`);
    console.log(` Target App: ${this.targetUrl}${options?.startPath || '/'}`);
    console.log(` Model: ${this.model}`);
    console.log(` Turn budget: ${maxTurns}`);
    console.log(`======================================================\n`);

    const browser: Browser = await chromium.launch({
      headless: true,
      // See walker.ts for why `--single-process`/`--no-zygote` are dropped
      // here too: unconditionally applying a constrained-container flag
      // combo to every launch causes exactly the blank-page rendering
      // issue that combo is documented to risk.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.LIVING_GRAPH_CHROMIUM_PATH || undefined,
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page: Page = await context.newPage();
    page.on('pageerror', (err) => console.log(`  [BROWSER ERROR] Uncaught exception on page: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  [BROWSER CONSOLE ERROR] ${msg.text()}`);
    });

    try {
      await page.goto(`${this.targetUrl}${options?.startPath || '/'}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);

      const initialShot = await page.screenshot({ fullPage: false });
      const systemPrompt = `You are operating a web browser via computer-use tools to accomplish a user's goal.
Coordinates are in the pixel space of the screenshots you receive (viewport ${VIEWPORT.width}x${VIEWPORT.height}).
Act carefully and deliberately, one action or a short batch at a time, taking a screenshot after each batch so you can see the result before deciding your next step.
Before each batch of one or more tool calls, always write one short, present-tense sentence describing what you're about to do — plain language an end user would read as tutorial narration (e.g. "Clicking the Invite Teammate button.", "Typing the teammate's email address."). Always include this sentence, even on the very first action.
When the goal has been fully achieved, stop issuing tool calls and reply with a plain-text confirmation describing what you accomplished — do not keep acting after the goal is met.
If the goal cannot be completed with what's available on screen after reasonably exploring, stop and explain why in plain text rather than continuing indefinitely or guessing wildly.`;

      const messages: Anthropic.MessageParam[] = [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: initialShot.toString('base64') } },
            { type: 'text', text: `Goal: "${goal}"\n\nHere is the current screen. Complete this goal.` },
          ],
        },
      ];

      let turn = 0;
      while (turn < maxTurns) {
        turn++;

        let response: Anthropic.Message | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            response = await this.client.messages.create({
              model: this.model,
              max_tokens: 4096,
              system: systemPrompt,
              messages,
              tools: [{ type: 'computer_toolset_20260801' }],
            });
            break;
          } catch (err: any) {
            console.log(`\n⚠ Anthropic call failed (attempt ${attempt}/2): ${err.message}`);
          }
        }

        if (!response) {
          stopReason = 'error';
          console.log(`\n✖ Giving up on turn ${turn} after repeated failures to reach the model.`);
          break;
        }

        messages.push({ role: 'assistant', content: response.content });

        const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
        const turnNarration = textBlocks.map((b) => b.text.trim()).filter(Boolean).join(' ');
        if (textBlocks.length > 0) {
          finalMessage = textBlocks.map((b) => b.text).join('\n');
          console.log(`\n[TURN ${turn}/${maxTurns}] ${finalMessage}`);
        }

        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

        if (toolUses.length === 0) {
          stopReason = 'model_stopped';
          console.log(`\n✔ Model stopped issuing actions — it believes the goal is resolved (see final message).`);
          break;
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUses) {
          let isError = false;
          let note: string | undefined;
          const selector = await this.captureSelector(page, toolUse.name, toolUse.input as any);
          try {
            const result = await this.executeAction(page, toolUse.name, toolUse.input as any);
            isError = !!result.isError;
            note = result.note;
          } catch (err: any) {
            isError = true;
            note = `Action failed: ${err.message}`;
          }

          await page.waitForTimeout(300);
          const shotBuffer = await page.screenshot({ fullPage: false });
          const shotPath = path.join(traceDir, `turn_${String(turn).padStart(2, '0')}_${toolUse.name}.png`);
          fs.writeFileSync(shotPath, shotBuffer);

          console.log(`  -> ${toolUse.name}(${JSON.stringify(toolUse.input)})${isError ? ` [ERROR: ${note}]` : ''}`);

          const playwrightCode = this.buildPlaywrightCode(toolUse.name, toolUse.input as any, selector);
          traces.push({
            turnIndex: turn,
            toolName: toolUse.name,
            input: toolUse.input,
            isError,
            note,
            screenshotPath: shotPath,
            narration: turnNarration || undefined,
            selector,
            playwrightCode,
          });

          const content: Anthropic.ToolResultBlockParam['content'] = [];
          if (note) content.push({ type: 'text', text: note });
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shotBuffer.toString('base64') } });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            toolset_name: toolUse.toolset_name ?? 'computer_toolset_20260801',
            content,
            is_error: isError,
          });
        }

        messages.push({ role: 'user', content: toolResults });
      }

      console.log(`\n======================================================`);
      console.log(` COMPUTER-USE WALK COMPLETE — ${stopReason.toUpperCase()}`);
      console.log(` Actions executed: ${traces.length}`);
      console.log(` Screenshots: ${traceDir}`);
      console.log(`======================================================\n`);

      return {
        goal,
        success: stopReason === 'model_stopped',
        stopReason,
        totalActions: traces.length,
        traces,
        finalMessage,
      };
    } finally {
      await browser.close();
    }
  }
}
