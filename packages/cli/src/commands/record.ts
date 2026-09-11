import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { GraphBuilder, WorkflowGraph, EnrichedWorkflow, formatSemanticNarration as formatEdgeNarration, cleanWorkflowTitle } from '@living-graph/extractor';
import { AutonomousWalker, ComputerUseWalker, buildAgenticReplayArtifacts } from '@living-graph/walker';
import { createVerifierClient } from '@living-graph/verifier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RecordOptions {
  out?: string;
  url?: string;
  uiVersion?: 'v1' | 'v2';
  topics?: string;
  all?: boolean;
  api?: string;
  apiKey?: string;
  push?: boolean;
  project?: string;
  skipWalk?: boolean;
  src?: string;
  engine?: 'deterministic' | 'agentic';
  maxSteps?: string;
}

/**
 * startNodeId may be a route GraphNode id directly, or a StateNode id
 * (intra-page state lives inside a route, not at the top level) — mirrors
 * AutonomousWalker's private resolveStartRoute so the agentic engine enters
 * the app at the same route the deterministic engine would have.
 */
function resolveStartRoute(graph: WorkflowGraph, startNodeId: string): string {
  const directNode = graph.nodes[startNodeId];
  if (directNode) return directNode.route;

  const stateNode = graph.stateNodes?.[startNodeId];
  if (stateNode) {
    const parentNode = graph.nodes[stateNode.parentRouteNodeId];
    if (parentNode) return parentNode.route;
  }

  return '/';
}

interface DiscoveredTopic {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: 'P0' | 'P1' | 'P2';
  difficulty: string;
  status: string;
  targetWorkflowId: string;
  reasoning: string;
  stepsCount: number;
  estimatedDurationSeconds: number;
  suggestedNarration?: string[];
  trajectoryNodes?: string[];
}

/**
 * Locates @living-graph/walker's own "output/traces" directory via Node
 * module resolution rather than guessing a fixed path depth relative to
 * process.cwd() or this file's __dirname. The previous fixed-depth guesses
 * only worked when the CLI ran from inside this monorepo's root; a
 * standalone/global install (walker hoisted somewhere else in
 * node_modules, or the CLI invoked from an arbitrary external project
 * directory) would silently find zero screenshots with no explanation.
 */
function resolveWalkerOutputDir(): string | null {
  try {
    const walkerPkgUrl = import.meta.resolve('@living-graph/walker/package.json');
    const walkerPkgPath = fileURLToPath(walkerPkgUrl);
    return path.resolve(path.dirname(walkerPkgPath), 'output/traces');
  } catch {
    return null;
  }
}

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function slugifyTopic(title: string, targetWorkflowId?: string): string {
  const source = targetWorkflowId
    ? targetWorkflowId.replace(/^workflow_/, '')
    : title;

  const base = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 35)
    .replace(/-+$/, '');

  // Two distinct topics can share the same 35-char prefix (e.g. two forms on
  // the same screen) and silently overwrite each other's bundle file on
  // disk. A short hash of the full, untruncated source guarantees each
  // generated filename stays unique regardless of truncation.
  const disambiguator = crypto.createHash('sha1').update(source).digest('hex').slice(0, 6);

  return `${base}-${disambiguator}`;
}

// Re-exported so existing callers/tests importing formatSemanticNarration
// from this module keep working; the actual heuristic lives in
// @living-graph/extractor (shared with llmEnricher.ts) so there is a single
// source of truth instead of two copies that can drift out of sync.
export function formatSemanticNarration(edge: any): string {
  const existing = (edge?.narration || '').trim();
  if (
    existing &&
    !existing.includes('Execute action on') &&
    !existing.includes('Perform action:') &&
    !existing.includes('button[') &&
    !existing.includes('input[') &&
    !existing.includes('data-testid') &&
    !existing.includes('->') &&
    existing.length > 10
  ) {
    return existing;
  }

  return formatEdgeNarration(edge?.action?.type, edge?.action?.targetLabel, edge?.action?.targetSelector, edge?.id);
}

export { cleanWorkflowTitle };

export function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}${min}${ss}`;
}

export async function recordCommand(options: RecordOptions): Promise<void> {
  const version = options.uiVersion || 'v2';
  const targetUrl = (options.url || 'http://localhost:5173').replace(/\/$/, '');
  const apiUrl = (options.api || process.env.LIVING_GRAPH_API_URL || 'http://localhost:3000').replace(/\/$/, '');
  const apiKey = (options.apiKey || process.env.LIVING_GRAPH_API_KEY || '').trim();

  const defaultOutDir = path.resolve(process.cwd(), 'output/bundles');
  let baseOutputDir = defaultOutDir;
  let singleZipOverride: string | null = null;

  if (options.out) {
    if (options.out.endsWith('.zip')) {
      singleZipOverride = path.resolve(process.cwd(), options.out);
      baseOutputDir = path.dirname(singleZipOverride);
    } else {
      baseOutputDir = path.resolve(process.cwd(), options.out);
    }
  }

  if (!fs.existsSync(baseOutputDir)) {
    fs.mkdirSync(baseOutputDir, { recursive: true });
  }

  let spawnedServer: any = null;

  console.log('\n======================================================');
  console.log('   LIVING GRAPH CLI: TOPIC CURATOR & LOCAL RECORDER');
  console.log('======================================================\n');
  console.log(`Target UI Version:  ${version}`);
  console.log(`Application URL:    ${targetUrl}`);
  console.log(`Cloud Discovery:    ${apiUrl}`);
  if (apiKey) {
    console.log(`API Key:            ${apiKey.slice(0, 8)}••••••••${apiKey.slice(-4)}`);
  }

  // 1. Extract AST Graph locally
  console.log('\n[1/5] Extracting AST State Machine from source code...');
  let builder: GraphBuilder;
  try {
    builder = new GraphBuilder(options.src);
  } catch (err: any) {
    console.error(`\n[ERROR] ${err.message}`);
    process.exit(1);
  }
  const graph: WorkflowGraph = await builder.buildGraph();
  if (version) {
    graph.version = version;
  }
  const nodeCount = Object.keys(graph.nodes).length;
  console.log(`✔ Extracted ${nodeCount} screen nodes and ${graph.edges.length} action edges.`);

  // 2. Discover Topics via Cloud API
  console.log('\n[2/5] Synthesizing candidate topics via Nemotron Nano 2 VL...');
  let candidateTopics: DiscoveredTopic[] = [];

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    const res = await fetch(`${apiUrl}/api/v1/topics/discover`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        graph,
        projectContext: 'Enterprise Web Application workflow state machine',
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      if (Array.isArray(data.topics) && data.topics.length > 0) {
        candidateTopics = data.topics;
        console.log(`✔ Cloud LLM generated ${candidateTopics.length} candidate tutorial topics.`);
      }
    }
  } catch (err: any) {
    console.warn(`[WARN] Cloud topic discovery unavailable (${err.message}). Using AST fallback.`);
  }

  // Fallback if cloud is unreachable
  if (candidateTopics.length === 0) {
    const sortedWorkflows = [...graph.workflows].sort((a, b) => {
      const aJourney = a.id.startsWith('wf_journey_') ? 1 : 0;
      const bJourney = b.id.startsWith('wf_journey_') ? 1 : 0;
      return bJourney - aJourney;
    });

    candidateTopics = sortedWorkflows.slice(0, 6).map((wf, idx) => {
      const workflowEdges = wf.edgeIds
        .map((eid) => graph.edges.find((e) => e.id === eid))
        .filter(Boolean);
      const suggestedNarration = workflowEdges.map((e) => formatSemanticNarration(e));
      const cleanTitle = cleanWorkflowTitle(wf.id, wf.title);

      return {
        id: wf.id || `topic_${idx + 1}`,
        title: cleanTitle,
        description:
          wf.description && !wf.description.includes('workflow on')
            ? wf.description
            : `End-to-end interactive journey demonstrating ${cleanTitle}.`,
        category: 'Core Workflows',
        priority: idx === 0 ? 'P0' : 'P1',
        difficulty: 'Beginner',
        status: 'pending_review',
        targetWorkflowId: wf.id,
        reasoning: 'Extracted directly from AST workflow transitions.',
        stepsCount: wf.edgeIds.length,
        estimatedDurationSeconds: wf.edgeIds.length * 5,
        suggestedNarration,
        trajectoryNodes: [wf.startNodeId, wf.endNodeId],
      };
    });
  }

  // 3. Select Topics (Interactive or Flag)
  console.log('\n[3/5] Topic Selection & Human-in-the-Loop Curation:');
  console.log('------------------------------------------------------');
  candidateTopics.forEach((topic, idx) => {
    console.log(`[${idx + 1}] ${topic.title} (${topic.priority} • ${topic.stepsCount} steps • ${topic.difficulty})`);
    console.log(`    Description: ${topic.description}`);
    if (topic.trajectoryNodes) {
      console.log(`    Target Path: ${topic.trajectoryNodes.join(' → ')}`);
    }
    console.log('');
  });

function parseTopicSelection(input: string, maxCount: number): number[] {
  if (input.toLowerCase() === 'all') {
    return Array.from({ length: maxCount }, (_, i) => i);
  }
  const indices = new Set<number>();
  const parts = input.split(',').map((s) => s.trim());
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
          if (i >= 1 && i <= maxCount) indices.add(i - 1);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= maxCount) {
        indices.add(num - 1);
      }
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

  const topicCount = candidateTopics.length;
  let selectedIndices: number[] = [];

  if (options.all) {
    selectedIndices = candidateTopics.map((_, idx) => idx);
    console.log('✔ Flag --all passed: Selected all candidate topics.');
  } else if (options.topics) {
    selectedIndices = parseTopicSelection(options.topics, topicCount);
    console.log(`✔ Flag --topics passed: Selected ${selectedIndices.length} topic(s).`);
  } else {
    const examples =
      topicCount > 2
        ? `"1", "1,3", "1-${topicCount}", or "all"`
        : topicCount === 2
        ? `"1", "1,2", or "all"`
        : `"1" or "all"`;
    const answer = await promptUser(
      `? Which topics would you like to record? (e.g. ${examples}) [1-${topicCount}, default: 1]: `
    );
    if (!answer || answer.trim() === '1') {
      selectedIndices = [0];
    } else {
      selectedIndices = parseTopicSelection(answer, topicCount);
    }
  }

  if (selectedIndices.length === 0) {
    console.log('[INFO] No valid topics chosen. Defaulting to Topic #1.');
    selectedIndices = [0];
  }

  const approvedTopics = selectedIndices.map((i) => ({
    ...candidateTopics[i],
    status: 'approved',
  }));

  console.log(`\n✔ Approved ${approvedTopics.length} topic(s) for local execution:`);
  approvedTopics.forEach((t) => console.log(`   • ${t.title} (${t.stepsCount} steps)`));

  // 4. Walk Workflows & Capture Keyframe Screenshots
  const topicScreenshotsMap = new Map<string, { stepName: string; filePath: string }[]>();

  if (options.skipWalk) {
    console.log('\n[4/5] Skipping browser walk (--skip-walk flag detected).');
  } else {
    console.log(`\n[4/5] Launching Playwright on ${targetUrl} for approved topics...`);

    // Check targetUrl connectivity
    let isReachable = false;
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(2000) });
      isReachable = res.ok || res.status < 500;
    } catch {}

    // Convenience-only: auto-start the dev server ONLY when the caller is
    // explicitly targeting this repo's own Deskly demo app's source
    // (--src .../apps/deskly/...). For any other target (a real external
    // codebase pointed at an unreachable localhost URL) this would spawn a
    // process the user never asked for and never expected — so it stays
    // silent and just reports the target is unreachable instead.
    const resolvedSrcDir = path.resolve(process.cwd(), options.src || 'src');
    const desklyDir = path.resolve(process.cwd(), 'apps/deskly');
    const isTargetingDeskly = resolvedSrcDir === desklyDir || resolvedSrcDir.startsWith(desklyDir + path.sep);

    if (!isReachable && isTargetingDeskly && (targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1'))) {
      if (fs.existsSync(desklyDir)) {
        console.log(`[LOCAL DEV] ${targetUrl} is offline. Auto-starting Deskly dev server...`);
        const { spawn } = await import('child_process');
        spawnedServer = spawn('npx', ['vite', '--port', '5173'], {
          cwd: desklyDir,
          shell: true,
          env: process.env,
          stdio: 'pipe',
        });

        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise((r) => setTimeout(r, 600));
          try {
            const res = await fetch(targetUrl, { signal: AbortSignal.timeout(1000) });
            if (res.ok || res.status < 500) {
              isReachable = true;
              console.log(`✔ Deskly dev server is up and listening at ${targetUrl}`);
              break;
            }
          } catch {}
        }
      }
    }

    if (isReachable) {
      console.log(`✔ Target application reachable at ${targetUrl}`);
    } else {
      console.warn(`\n[NOTICE] Could not connect to target URL: ${targetUrl}`);
      console.warn(`         Live browser walk skipped. Using trace keyframes from disk...\n`);
    }

    const engine = options.engine === 'agentic' ? 'agentic' : 'deterministic';
    console.log(`   Walk Engine:        ${engine}${engine === 'agentic' ? ' (Claude computer-use)' : ''}`);

    if (engine === 'agentic') {
      const maxTurns = options.maxSteps ? parseInt(options.maxSteps, 10) : 15;

      for (const topic of approvedTopics) {
        const targetWorkflow =
          graph.workflows.find((w) => w.id === topic.targetWorkflowId) || graph.workflows[0];
        const startPath = targetWorkflow ? resolveStartRoute(graph, targetWorkflow.startNodeId) : '/';

        console.log(`\n▶ Agentic walk: ${topic.title} (goal-driven, no scripted path)`);

        if (!isReachable) {
          console.warn(`[WARN] Target unreachable — skipping agentic walk for "${topic.title}".`);
          topicScreenshotsMap.set(topic.id, []);
          continue;
        }

        try {
          const agenticWalker = new ComputerUseWalker(targetUrl);
          const goal = `${topic.title}. ${topic.description}`.trim();
          const result = await agenticWalker.walkGoal(goal, { startPath, maxTurns });
          const artifacts = buildAgenticReplayArtifacts(result, { baseUrl: targetUrl, startPath });

          const enrichedWorkflow: EnrichedWorkflow = {
            id: artifacts.workflow.id,
            title: artifacts.workflow.title,
            description: artifacts.workflow.description,
            difficulty: (topic.difficulty || 'Beginner').toLowerCase() as EnrichedWorkflow['difficulty'],
            priority: topic.priority || 'P1',
            startNodeId: artifacts.workflow.startNodeId,
            endNodeId: artifacts.workflow.endNodeId,
            edgeIds: artifacts.workflow.edgeIds,
            steps: artifacts.edges.map((e) => ({ edgeId: e.id, narration: e.narration, playwrightCode: e.playwrightCode })),
          };
          graph.edges.push(...artifacts.edges);
          graph.workflows.push(enrichedWorkflow);

          topic.targetWorkflowId = enrichedWorkflow.id;
          topic.stepsCount = artifacts.steps.length;
          topic.suggestedNarration = artifacts.edges.map((e) => e.narration);

          topicScreenshotsMap.set(
            topic.id,
            artifacts.steps.map((s) => ({
              stepName: `step_${String(s.stepNumber).padStart(2, '0')}_${s.edgeId}.png`,
              filePath: s.screenshotPath,
            }))
          );

          console.log(
            `✔ Agentic walk complete for "${topic.title}": ${result.totalActions} action(s), ${artifacts.steps.length} tutorial step(s) (${result.stopReason}).`
          );
          if (!result.success) {
            console.warn(`  [WARN] Model did not confirm the goal was reached: ${result.finalMessage || '(no final message)'}`);
          }
        } catch (err: any) {
          console.warn(`[WARN] Agentic walk failed for "${topic.title}": ${err.message}`);
          topicScreenshotsMap.set(topic.id, []);
        }
      }

      // Skip the deterministic walk loop below entirely for this engine.
    } else {
    const verifier = createVerifierClient();
    const walker = new AutonomousWalker(verifier, targetUrl);

    for (const topic of approvedTopics) {
      const targetWorkflow =
        graph.workflows.find((w) => w.id === topic.targetWorkflowId) || graph.workflows[0];
      if (!targetWorkflow) {
        console.warn(`[WARN] Workflow "${topic.targetWorkflowId}" not found in graph. Skipping walk.`);
        continue;
      }

      console.log(`\n▶ Walking: ${topic.title} (${targetWorkflow.id} • ${targetWorkflow.edgeIds.length} steps)`);
      const topicScreenshots: { stepName: string; filePath: string }[] = [];
      let liveWalkSuccess = false;

      if (isReachable) {
        try {
          const walkResult = await walker.walkWorkflow(graph, targetWorkflow.id, {
            enableSelfHealing: true,
            uiVersion: version,
          });

          console.log(`✔ Completed walk: ${walkResult.verifiedSteps}/${walkResult.totalSteps} steps verified.`);
          if (walkResult.healedSteps > 0) {
            console.log(`  [HEALED] Repaired ${walkResult.healedSteps} broken selector(s) in-flight!`);
          }

          walkResult.traces.forEach((trace, sIdx) => {
            if (trace.screenshotPath && fs.existsSync(trace.screenshotPath)) {
              topicScreenshots.push({
                stepName: `step_${String(sIdx + 1).padStart(2, '0')}_${trace.edgeId}.png`,
                filePath: trace.screenshotPath,
              });
            }
          });
          liveWalkSuccess = true;
        } catch (err: any) {
          console.warn(`[WARN] Live walk encountered an issue: ${err.message}`);
        }
      }

      // Precise 1:1 screenshot mapping for each step of the target workflow.
      // Resolve the walker's actual install location first (portable across
      // a standalone/global CLI install); fall back to the fixed monorepo
      // paths this repo's own dev workflow has always used.
      const resolvedWalkerDir = resolveWalkerOutputDir();
      const candidateDirs = [
        ...(resolvedWalkerDir
          ? [
              path.resolve(resolvedWalkerDir, targetWorkflow.id, version),
              path.resolve(resolvedWalkerDir, targetWorkflow.id),
            ]
          : []),
        path.resolve(process.cwd(), 'packages/walker/output/traces', targetWorkflow.id, version),
        path.resolve(process.cwd(), 'packages/walker/output/traces', targetWorkflow.id),
        path.resolve(__dirname, '../../walker/output/traces', targetWorkflow.id, version),
        path.resolve(__dirname, '../../walker/output/traces', targetWorkflow.id),
      ];

      const topicCapturedScreenshots: { stepName: string; filePath: string }[] = [];
      for (let i = 0; i < targetWorkflow.edgeIds.length; i++) {
        const edgeId = targetWorkflow.edgeIds[i];
        const stepNum = i + 1;
        const paddedPrefix = `step_${String(stepNum).padStart(2, '0')}_`;
        const rawPrefix = `step_${stepNum}_`;

        // Check if live walker captured this step for this topic
        let matched = topicScreenshots.find(
          (s) =>
            (edgeId && s.stepName.includes(edgeId)) ||
            s.stepName.startsWith(paddedPrefix) ||
            s.stepName.startsWith(rawPrefix)
        );

        // If not in live walker, locate from trace directory on disk
        if (!matched || !fs.existsSync(matched.filePath)) {
          for (const cDir of candidateDirs) {
            if (fs.existsSync(cDir)) {
              const files = fs.readdirSync(cDir).filter((f) => f.endsWith('.png') && !f.includes('_result_') && !f.includes('step_final'));
              // Highest priority: matches both step number and edgeId
              let chosen = files.find(
                (f) => (f.startsWith(paddedPrefix) || f.startsWith(rawPrefix)) && f.includes(edgeId)
              );
              // Second priority: matches step number exactly
              if (!chosen) {
                chosen = files.find((f) => f.startsWith(paddedPrefix) || f.startsWith(rawPrefix));
              }
              // Third priority: matches edgeId
              if (!chosen && edgeId) {
                chosen = files.find((f) => f.includes(edgeId));
              }

              if (chosen) {
                const fullPath = path.join(cDir, chosen);
                matched = {
                  stepName: `${paddedPrefix}${edgeId}.png`,
                  filePath: fullPath,
                };
                break;
              }
            }
          }
        }

        if (matched && fs.existsSync(matched.filePath)) {
          topicCapturedScreenshots.push({
            stepName: `${paddedPrefix}${edgeId}.png`,
            filePath: matched.filePath,
          });
        }
      }

      topicScreenshotsMap.set(topic.id, topicCapturedScreenshots);

      if (liveWalkSuccess) {
        console.log(`✔ Verified ${topicCapturedScreenshots.length}/${targetWorkflow.edgeIds.length} step keyframe(s) via live Playwright walk for "${topic.title}".`);
      } else {
        console.log(`✔ Loaded ${topicCapturedScreenshots.length}/${targetWorkflow.edgeIds.length} cached step keyframe(s) from disk for "${topic.title}".`);
      }
    }
    }
  }

  // 5. Package into per-topic ZIP Bundles
  console.log('\n[5/5] Packaging Living Graph artifact bundle(s)...');
  const timestamp = formatTimestamp();
  const generatedBundles: {
    topic: DiscoveredTopic;
    bundlePath: string;
    sizeKb: string;
    screenshotCount: number;
  }[] = [];

  for (let idx = 0; idx < approvedTopics.length; idx++) {
    const topic = approvedTopics[idx];
    const topicScreenshots = topicScreenshotsMap.get(topic.id) || [];
    const slug = slugifyTopic(topic.title, topic.targetWorkflowId);

    let bundlePath: string;
    if (singleZipOverride && approvedTopics.length === 1) {
      bundlePath = singleZipOverride;
    } else {
      bundlePath = path.join(baseOutputDir, `${slug}_${timestamp}.zip`);
    }

    const zip = new JSZip();

    // 1. graph.json (AST schema with semantic narrations guaranteed)
    const enrichedEdges = (graph.edges || []).map((e: any) => ({
      ...e,
      narration: e.narration?.trim() || formatSemanticNarration(e),
    }));
    const enrichedGraph = {
      ...graph,
      edges: enrichedEdges,
    };
    zip.file('graph.json', JSON.stringify(enrichedGraph, null, 2));

    // 2. selected_topics.json (isolated to this 1 topic)
    zip.file('selected_topics.json', JSON.stringify([topic], null, 2));

    // 3. manifest.json
    const manifest = {
      version: '0.1.0',
      generatedAt: new Date().toISOString(),
      uiVersion: version,
      targetUrl,
      topicId: topic.id,
      topicTitle: topic.title,
      targetWorkflowId: topic.targetWorkflowId,
      stepCount: topic.stepsCount,
      screenshotCount: topicScreenshots.length,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // 4. screenshots/
    const screenshotsFolder = zip.folder('screenshots');
    for (const item of topicScreenshots) {
      if (fs.existsSync(item.filePath)) {
        screenshotsFolder?.file(item.stepName, fs.readFileSync(item.filePath));
      }
    }

    // Generate ZIP file buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    fs.writeFileSync(bundlePath, zipBuffer);
    const stats = fs.statSync(bundlePath);
    const sizeKb = (stats.size / 1024).toFixed(1);

    generatedBundles.push({
      topic,
      bundlePath,
      sizeKb,
      screenshotCount: topicScreenshots.length,
    });
  }

  console.log('\n======================================================');
  console.log(`✔ GENERATED ${generatedBundles.length} TOPIC BUNDLE(S) IN:`);
  console.log(`  ${baseOutputDir}`);
  console.log('======================================================\n');

  console.log('Summary of Generated Bundles:');
  generatedBundles.forEach((b, i) => {
    console.log(` • [${i + 1}] ${path.basename(b.bundlePath)} (${b.sizeKb} KB • ${b.screenshotCount} keyframes)`);
    console.log(`       Topic: ${b.topic.title}`);
    console.log(`       Path:  ${b.bundlePath}`);
  });

  if (options.push) {
    const projectId = options.project || 'default';
    console.log(`\n======================================================`);
    console.log(`   [PUSH] INGESTING BUNDLE(S) TO CLOUD (${apiUrl})`);
    console.log(`======================================================\n`);
    for (const b of generatedBundles) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['x-api-key'] = apiKey;

        const pushRes = await fetch(`${apiUrl}/api/v1/projects/${projectId}/bundles`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            graph,
            manifest: {
              projectName: b.topic.title,
              targetUrl,
              version,
            },
            selectedTopics: [b.topic],
          }),
        });

        if (pushRes.ok) {
          console.log(`✔ [Push] Successfully ingested into project "${projectId}": ${path.basename(b.bundlePath)}`);
        } else {
          console.error(`❌ [Push] Failed to ingest bundle (${pushRes.status}): ${await pushRes.text()}`);
        }
      } catch (err: any) {
        console.error(`❌ [Push] Failed to reach cloud API: ${err.message}`);
      }
    }
    console.log('');
  }

  console.log('\nNext Steps:');
  console.log(' 1. Open Living Graph Cloud: http://localhost:5174 (or "npm run dev:cloud")');
  console.log(` 2. Upload any bundle from "${path.relative(process.cwd(), baseOutputDir)}"`);
  console.log(' 3. Generate studio video with voiceover narration & download .mp4!\n');

  if (spawnedServer) {
    try {
      spawnedServer.kill();
    } catch {}
  }
}
