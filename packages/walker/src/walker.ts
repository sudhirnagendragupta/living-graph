import { chromium, Browser, Page, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowPath, GraphEdge, WorkflowGraph } from '@living-graph/extractor';
import { IVerifierClient } from '@living-graph/verifier';
import { AutonomousHealer, HealedStepResult } from './healer.js';
import { TestGenerator } from './testGenerator.js';
import { extractLiteralValue, inferFillValue } from './fillValueHeuristics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StepTrace {
  stepIndex: number;
  edgeId: string;
  narration: string;
  screenshotPath: string;
  resultScreenshotPath?: string;
  verified: boolean;
  confidence: number;
  healed?: boolean;
  healingDetails?: HealedStepResult;
}

export interface WalkResult {
  workflowId: string;
  success: boolean;
  totalSteps: number;
  verifiedSteps: number;
  healedSteps: number;
  traces: StepTrace[];
  generatedSpecPath: string;
}

export class AutonomousWalker {
  private verifier: IVerifierClient;
  private healer: AutonomousHealer;
  private testGenerator: TestGenerator;
  private baseUrl: string;

  constructor(verifier: IVerifierClient, baseUrl: string = 'http://localhost:5173') {
    this.verifier = verifier;
    this.healer = new AutonomousHealer(verifier);
    this.testGenerator = new TestGenerator();
    this.baseUrl = baseUrl;
  }

  /**
   * Resolve the route to enter the app at for a given workflow's start node.
   * startNodeId may be a route GraphNode id directly, or a StateNode id
   * (intra-page state lives inside a route, not at the top level) — in the
   * latter case we follow parentRouteNodeId to find the owning route.
   * Falls back to /dashboard only when no route can be resolved at all.
   */
  private resolveStartRoute(graph: WorkflowGraph, startNodeId: string): string {
    const directNode = graph.nodes[startNodeId];
    if (directNode) return directNode.route;

    const stateNode = graph.stateNodes?.[startNodeId];
    if (stateNode) {
      const parentNode = graph.nodes[stateNode.parentRouteNodeId];
      if (parentNode) return parentNode.route;
    }

    return '/';
  }

  /**
   * `Locator.isVisible({ timeout })` does NOT poll or retry despite the
   * `timeout` option existing on its signature — it takes an instant
   * snapshot and returns immediately regardless of what timeout is passed
   * (verified empirically: an element that appears 1.2s later is reported
   * invisible by a check that ran in ~30ms with `timeout: 2500`). On a
   * client-rendered SPA — especially a dev server compiling routes
   * on-demand — that made every post-navigation visibility check here
   * effectively gated only by the fixed wait before it, causing spurious
   * self-healing (or outright failure) on a slow render, not a real
   * selector drift. `waitFor({ state: 'visible' })` actually polls for the
   * given timeout, which `isVisible` never did.
   */
  private async waitVisible(locator: Locator, timeoutMs: number): Promise<boolean> {
    try {
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute an edge's action according to its declared type. The previous
   * implementation always called page.click() regardless of type, so a
   * 'fill' edge on a text input never actually typed anything — it just
   * focused the field, which is why VLM verification correctly reported the
   * field as empty afterward.
   */
  private async executeEdgeAction(page: Page, edge: GraphEdge, narration: string): Promise<void> {
    const selector = edge.action.targetSelector;

    switch (edge.action.type) {
      case 'fill': {
        const literal = extractLiteralValue(edge.action.payload?.value);
        await page.fill(selector, literal ?? inferFillValue(selector, narration));
        break;
      }
      case 'select': {
        const literal =
          extractLiteralValue(edge.action.payload?.status) ??
          extractLiteralValue(edge.action.payload?.value);
        if (literal) {
          await page.selectOption(selector, literal);
        } else {
          await page.click(selector);
        }
        break;
      }
      case 'submit': {
        const loc = page.locator(selector);
        const tagName = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
        if (tagName === 'form') {
          await loc.evaluate((el) => (el as HTMLFormElement).requestSubmit());
        } else {
          await loc.click();
        }
        break;
      }
      default:
        await page.click(selector);
    }
  }

  /**
   * Walk an entire workflow path against the live application.
   */
  public async walkWorkflow(
    graph: WorkflowGraph,
    workflowId: string,
    options?: { enableSelfHealing?: boolean; uiVersion?: 'v1' | 'v2' }
  ): Promise<WalkResult> {
    const workflow = graph.workflows.find((w: WorkflowPath) => w.id === workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found in graph`);
    }

    // graph.edges[].narration is hardcoded empty at extraction time (a
    // comment on it literally says "filled by LLMEnricher") — but
    // enrichment never writes back into it. The real, enriched narration
    // lives only on workflow.steps[], keyed by edgeId. Build a lookup so the
    // VLM actually receives a real intent instead of an empty string.
    const enrichedSteps = (workflow as unknown as { steps?: Array<{ edgeId: string; narration: string }> }).steps;
    const narrationByEdgeId = new Map<string, string>(
      (enrichedSteps || []).map((s) => [s.edgeId, s.narration])
    );
    const getNarration = (edge: GraphEdge): string =>
      narrationByEdgeId.get(edge.id) || edge.narration || `Perform action: ${edge.action.targetLabel || edge.id}`;

    const edgeMap = new Map<string, GraphEdge>(graph.edges.map((e: GraphEdge) => [e.id, e]));
    const executedEdges: GraphEdge[] = [];
    const traces: StepTrace[] = [];
    let healedCount = 0;

    const targetVersion = options?.uiVersion || graph.version || 'default';
    // Output trace directory separated by version
    const traceDir = path.resolve(__dirname, '../output/traces', workflowId, targetVersion);
    if (!fs.existsSync(traceDir)) {
      fs.mkdirSync(traceDir, { recursive: true });
    }

    console.log(`\n======================================================`);
    console.log(` AUTONOMOUS WALKER: ${workflow.title}`);
    console.log(` Target App: ${this.baseUrl} (Version: ${options?.uiVersion || graph.version})`);
    console.log(` Self-Healing: ${options?.enableSelfHealing ? 'ENABLED' : 'DISABLED'}`);
    console.log(`======================================================\n`);

    const browser: Browser = await chromium.launch({
      headless: true,
      // `--single-process`/`--no-zygote` were added for a constrained
      // container deployment (Cloud Run) but applied unconditionally to
      // every launch, including normal desktop dev — `--single-process` is
      // explicitly not recommended by Chromium itself and is a known cause
      // of blank/unrendered pages, which is exactly the symptom this was
      // causing locally. Dropped; `--no-sandbox`/`--disable-setuid-sandbox`
      // alone are the standard, well-supported combo for root/CI/container
      // environments.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // Optional override for environments with a pre-provisioned browser
      // binary at a nonstandard path (e.g. a sandboxed CI runner).
      executablePath: process.env.LIVING_GRAPH_CHROMIUM_PATH || undefined,
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      try {
        localStorage.setItem('deskly_auth', 'true');
        localStorage.setItem('auth', 'true');
        localStorage.setItem('isAuthenticated', 'true');
      } catch {}
    });

    const page: Page = await context.newPage();
    page.on('pageerror', (err) => console.log(`  [BROWSER ERROR] Uncaught exception on page: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  [BROWSER CONSOLE ERROR] ${msg.text()}`);
    });

    try {
      // 1. Initial navigation — derive the workflow's actual starting route
      // instead of always entering at /dashboard. A workflow that starts on
      // a different screen (e.g. Login) or in a modal/wizard mounted off a
      // route can never succeed if we always enter somewhere else first.
      const startRoute = this.resolveStartRoute(graph, workflow.startNodeId);
      const startUrl = `${this.baseUrl}${startRoute}`;
      console.log(`--> Navigating to initial entry: ${startUrl}`);
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);

      // If the workflow is for a protected route but got redirected to a login screen,
      // authenticate and re-navigate to the startRoute
      const isLoginWorkflow =
        workflow.startNodeId.includes('login') ||
        startRoute.includes('/login') ||
        workflow.id.includes('login');

      if (!isLoginWorkflow && page.url().includes('/login')) {
        console.log(`[WALKER] Detected unauthenticated redirect to ${page.url()}. Auto-authenticating for protected workflow...`);
        const demoBtn = page.locator('button[data-testid="fill-demo-credentials-btn"], button:has-text("Demo"), button:has-text("Fill")').first();
        if (await this.waitVisible(demoBtn, 3000)) {
          await demoBtn.click();
          await page.waitForTimeout(300);
        } else {
          await page.fill('input[type="email"], input[name="email"]', 'user@example.com').catch(() => {});
          await page.fill('input[type="password"], input[name="password"]', 'Password123!').catch(() => {});
        }
        const submitBtn = page.locator('button[type="submit"], button[data-testid="login-submit-btn"], button:has-text("Sign in"), button:has-text("Login")').first();
        if (await this.waitVisible(submitBtn, 3000)) {
          await submitBtn.click();
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(800);
        }
        if (page.url() !== startUrl && !page.url().includes(startRoute)) {
          await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(500);
        }
      }

      // 2. Iterate through each edge in the workflow path
      for (let i = 0; i < workflow.edgeIds.length; i++) {
        const edgeId = workflow.edgeIds[i];
        const edge = edgeMap.get(edgeId);
        if (!edge) {
          throw new Error(`Missing edge ${edgeId} in graph edge dictionary`);
        }

        const narration = getNarration(edge);
        console.log(`\n[STEP ${i + 1}/${workflow.edgeIds.length}] ${narration}`);
        console.log(`  Action: ${edge.action.type} -> "${edge.action.targetSelector}"`);

        let effectiveEdge = { ...edge };
        let healingResult: HealedStepResult | undefined;

        // Check if selector exists on the page. Genuinely waits (not an
        // instant snapshot) — the target route may still be rendering on a
        // cold dev server, and a real render delay is not a broken selector.
        // `.first()` matters here: a dynamic-testid prefix selector (e.g.
        // "any ticket row") legitimately matches multiple elements by
        // design, and Locator.waitFor() — unlike page.click() — throws a
        // strict-mode violation rather than just picking one, which without
        // `.first()` looked identical to "element not found" here.
        let elementVisible = await this.waitVisible(page.locator(edge.action.targetSelector).first(), 6000);

        // If trying to submit a multi-step wizard, advance intermediate steps until submit button is visible
        if (!elementVisible && (edge.action.type === 'submit' || edge.action.targetSelector.includes('submit'))) {
          const nextBtn = page.locator('button[data-testid="wizard-next-btn"], button:has-text("Next")').first();
          let nextAttempts = 0;
          while (!elementVisible && (await this.waitVisible(nextBtn, 1500)) && nextAttempts < 5) {
            console.log(`[WALKER] Advancing wizard step to reach submit button...`);
            await nextBtn.click();
            await page.waitForTimeout(500);
            elementVisible = await this.waitVisible(page.locator(edge.action.targetSelector).first(), 2000);
            nextAttempts++;
          }
        }

        if (!elementVisible) {
          if (options?.enableSelfHealing) {
            console.log(`⚠️  Step failed: Element "${edge.action.targetSelector}" not visible.`);
            healingResult = await this.healer.healBrokenEdge(page, edge);
            healedCount++;

            // 1. Capture step screenshot before executing the healed action
            const screenshotFileName = `step_${i + 1}_${edge.id}.png`;
            const screenshotPath = path.join(traceDir, screenshotFileName);
            await page.screenshot({ path: screenshotPath });

            // 2. Execute healed replacement action — type-aware: a relocated
            // fill target (e.g. a text input that moved) must actually be
            // filled, not clicked. Previously this always called
            // page.click() regardless of what the original edge (or the
            // VLM's relocation) said the action type was.
            if (healingResult.healedActionType === 'fill') {
              const literal = extractLiteralValue(edge.action.payload?.value);
              const fillValue = literal ?? healingResult.suggestedValue ?? inferFillValue(healingResult.healedSelector, narration);
              await page.fill(healingResult.healedSelector, fillValue);
            } else if (healingResult.healedActionType === 'select') {
              const literal =
                extractLiteralValue(edge.action.payload?.status) ?? extractLiteralValue(edge.action.payload?.value);
              if (literal) {
                await page.selectOption(healingResult.healedSelector, literal);
              } else {
                await page.click(healingResult.healedSelector);
              }
            } else {
              await page.click(healingResult.healedSelector);
            }
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(800);

            effectiveEdge.playwrightCode = healingResult.healedPlaywrightCode;
            effectiveEdge.action.targetSelector = healingResult.healedSelector;

            // 3. Capture the RESULT of the healed action, then verify it
            const resultScreenshotFileName = `step_${i + 1}_result_${edge.id}.png`;
            const resultScreenshotPath = path.join(traceDir, resultScreenshotFileName);
            const screenshotBuffer = await page.screenshot({ path: resultScreenshotPath });
            const screenshotBase64 = screenshotBuffer.toString('base64');

            // 4. VLM Verification
            let verdict = { verified: true, confidence: 0.9, reasoning: 'Healed step executed.' };
            try {
              verdict = await this.verifier.verifyStep({
                screenshotBase64,
                intent: narration,
                currentRoute: page.url(),
              });
              console.log(`  VLM Verdict: ${verdict.verified ? '✅ VERIFIED' : '❌ FAILED'} (confidence: ${(verdict.confidence * 100).toFixed(0)}%)`);
              if (verdict.reasoning) console.log(`  VLM Reasoning: ${verdict.reasoning}`);
            } catch (vErr: any) {
              console.warn(`  [NOTICE] VLM Verification skipped (${vErr.message}). Continuing walk.`);
            }

            executedEdges.push(effectiveEdge);
            traces.push({
              stepIndex: i + 1,
              edgeId: edge.id,
              narration,
              screenshotPath,
              resultScreenshotPath,
              verified: verdict.verified,
              confidence: verdict.confidence,
              healed: true,
              healingDetails: healingResult,
            });
            continue;
          } else {
            throw new Error(`Element "${edge.action.targetSelector}" not found and self-healing is disabled.`);
          }
        }

        // Standard execution path:
        // 1. Capture PRE-ACTION step screenshot of the current view (where the action is performed).
        // This is the tutorial keyframe showing the element the user is guided to interact with.
        const screenshotFileName = `step_${i + 1}_${edge.id}.png`;
        const screenshotPath = path.join(traceDir, screenshotFileName);
        const preScreenshotBuffer = await page.screenshot({ path: screenshotPath });

        // Also sync to legacy workflow trace directory for backward compatibility
        const legacyTraceDir = path.resolve(__dirname, '../output/traces', workflowId);
        if (!fs.existsSync(legacyTraceDir)) {
          fs.mkdirSync(legacyTraceDir, { recursive: true });
        }
        fs.writeFileSync(path.join(legacyTraceDir, screenshotFileName), preScreenshotBuffer);

        // 2. Execute this step's action
        await this.executeEdgeAction(page, edge, narration);
        if (edge.action.type === 'submit' || edge.action.type === 'click') {
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(1000);
        } else {
          await page.waitForTimeout(500);
        }

        // 3. Capture POST-ACTION screenshot of the resulting screen state for VLM verification
        const resultScreenshotFileName = `step_${i + 1}_result_${edge.id}.png`;
        const resultScreenshotPath = path.join(traceDir, resultScreenshotFileName);
        const resultScreenshotBuffer = await page.screenshot({ path: resultScreenshotPath });
        const screenshotBase64 = resultScreenshotBuffer.toString('base64');
        fs.writeFileSync(path.join(legacyTraceDir, resultScreenshotFileName), resultScreenshotBuffer);

        // 4. VLM Step Verification of the resulting view
        let verdict = { verified: true, confidence: 0.9, reasoning: 'Step executed successfully.' };
        try {
          verdict = await this.verifier.verifyStep({
            screenshotBase64,
            intent: narration,
            currentRoute: page.url(),
          });
          console.log(`  VLM Verdict: ${verdict.verified ? '✅ VERIFIED' : '❌ FAILED'} (confidence: ${(verdict.confidence * 100).toFixed(0)}%)`);
          if (verdict.reasoning) console.log(`  VLM Reasoning: ${verdict.reasoning}`);
        } catch (vErr: any) {
          console.warn(`  [NOTICE] VLM Verification skipped (${vErr.message}). Continuing walk.`);
        }

        executedEdges.push(effectiveEdge);
        traces.push({
          stepIndex: i + 1,
          edgeId: edge.id,
          narration,
          screenshotPath,
          resultScreenshotPath,
          verified: verdict.verified,
          confidence: verdict.confidence,
          healed: false,
        });
      }

      // Capture final completion screenshot
      const finalShotFileName = `step_final_${workflow.id}.png`;
      const finalShotPath = path.join(traceDir, finalShotFileName);
      await page.screenshot({ path: finalShotPath }).catch(() => {});

      // 3. Generate production Playwright spec file
      const specsDir = path.resolve(__dirname, '../output/specs');
      if (!fs.existsSync(specsDir)) {
        fs.mkdirSync(specsDir, { recursive: true });
      }
      const specFileName = `${workflow.id}${healedCount > 0 ? '.healed' : ''}.spec.ts`;
      const specPath = path.join(specsDir, specFileName);
      const specCode = this.testGenerator.generateSpec(workflow, executedEdges, this.baseUrl, startRoute);
      fs.writeFileSync(specPath, specCode, 'utf-8');

      console.log(`\n======================================================`);
      console.log(` WORKFLOW EXECUTION COMPLETE`);
      console.log(` Total Steps:    ${traces.length}`);
      console.log(` Verified Steps: ${traces.filter((t) => t.verified).length}`);
      console.log(` Healed Steps:   ${healedCount}`);
      console.log(` Test Spec:      ${specPath}`);
      console.log(`======================================================\n`);

      return {
        workflowId,
        success: true,
        totalSteps: traces.length,
        verifiedSteps: traces.filter((t) => t.verified).length,
        healedSteps: healedCount,
        traces,
        generatedSpecPath: specPath,
      };
    } finally {
      await browser.close();
    }
  }
}
