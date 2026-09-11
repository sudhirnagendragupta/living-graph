import * as fs from 'fs';
import * as path from 'path';
import { WorkflowGraph } from '@living-graph/extractor';

export interface DispatchOptions {
  api?: string;
  apiKey?: string;
  previewUrl: string;
  graph?: string;
  workflow?: string;
  uiVersion?: 'v1' | 'v2';
  wait?: boolean;
  outSpec?: string;
  outVideo?: string;
  engine?: 'deterministic' | 'agentic';
  goal?: string;
  maxSteps?: string;
}

export async function dispatchCommand(options: DispatchOptions): Promise<void> {
  const apiUrl = (options.api || process.env.LIVING_GRAPH_API_URL || 'http://localhost:3000').replace(/\/$/, '');
  const apiKey = (options.apiKey || process.env.LIVING_GRAPH_API_KEY || '').trim();
  const graphFile = path.resolve(process.cwd(), options.graph || 'workflow_graph_v2.json');

  if (!options.previewUrl) {
    console.error('[ERROR] Missing required option: --preview-url <url>');
    process.exit(1);
  }

  if (!fs.existsSync(graphFile)) {
    console.error(`[ERROR] Graph file not found: ${graphFile}`);
    console.error('Run "npx living-graph extract" first or specify --graph <path>.');
    process.exit(1);
  }

  const graphData: WorkflowGraph = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));

  console.log('\n======================================================');
  console.log('   LIVING GRAPH CLI: CLOUD JOB DISPATCHER');
  console.log('======================================================\n');
  const engine = options.engine === 'agentic' ? 'agentic' : 'deterministic';

  console.log(`Cloud API Endpoint: ${apiUrl}`);
  console.log(`Staging/Preview:    ${options.previewUrl}`);
  console.log(`Target UI Version:  ${options.uiVersion || 'v2'}`);
  console.log(`Walk Engine:        ${engine}${engine === 'agentic' ? ' (Claude computer-use)' : ''}`);

  // 1. Submit Job to Living Graph Cloud API
  const payload = {
    previewUrl: options.previewUrl,
    workflowId: options.workflow,
    uiVersion: options.uiVersion || 'v2',
    graph: graphData,
    options: {
      enableSelfHealing: true,
      renderVideo: true,
      speechRate: 140,
      engine,
      goal: options.goal,
      maxTurns: options.maxSteps ? parseInt(options.maxSteps, 10) : undefined,
    },
  };

  let submitRes;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  try {
    submitRes = await fetch(`${apiUrl}/api/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    console.error(`\n[ERROR] Failed to reach Living Graph API at ${apiUrl}: ${err.message}`);
    process.exit(1);
  }

  if (!submitRes.ok) {
    const errorText = await submitRes.text();
    console.error(`\n[ERROR] API rejected run request (${submitRes.status}): ${errorText}`);
    process.exit(1);
  }

  const runInfo = (await submitRes.json()) as { runId: string; status: string; statusUrl: string };
  console.log(`\n🚀 Job Enqueued Successfully!`);
  console.log(`   • Run ID:     ${runInfo.runId}`);
  console.log(`   • Status:     ${runInfo.status}`);
  console.log(`   • Status URL: ${apiUrl}${runInfo.statusUrl}`);

  if (!options.wait) {
    console.log(`\nTip: Use --wait to block until execution completes and automatically download artifacts.\n`);
    return;
  }

  // 2. Poll until completion
  console.log(`\n⏳ Polling execution status every 2 seconds...`);
  const statusEndpoint = `${apiUrl}/api/v1/runs/${runInfo.runId}`;

  while (true) {
    await new Promise((r) => setTimeout(r, 2000));

    const pollRes = await fetch(statusEndpoint, { headers });
    if (!pollRes.ok) {
      console.warn(`[WARN] Polling failed (${pollRes.status}), retrying...`);
      continue;
    }

    const run = (await pollRes.json()) as any;

    if (run.status === 'running') {
      process.stdout.write(`• [RUNNING] Navigating workflow on ${options.previewUrl}...\r`);
    } else if (run.status === 'completed') {
      console.log(`\n\n======================================================`);
      console.log(`   JOB COMPLETED SUCCESSFULLY ✅`);
      console.log(`   Total Steps:    ${run.result.totalSteps}`);
      console.log(`   Verified Steps: ${run.result.verifiedSteps}`);
      console.log(`   Healed Steps:   ${run.result.healedSteps}`);
      if (run.result.videoDurationSeconds) {
        console.log(`   Video Duration: ${run.result.videoDurationSeconds.toFixed(1)}s`);
      }
      console.log(`======================================================\n`);

      // Download test spec if requested
      if (options.outSpec && run.result.specContent) {
        const specDest = path.resolve(process.cwd(), options.outSpec);
        const specDir = path.dirname(specDest);
        if (!fs.existsSync(specDir)) fs.mkdirSync(specDir, { recursive: true });
        fs.writeFileSync(specDest, run.result.specContent, 'utf-8');
        console.log(`💾 Saved Playwright Test Spec -> ${specDest}`);
      }

      // Download video if requested
      if (options.outVideo && run.result.videoUrl) {
        const videoDest = path.resolve(process.cwd(), options.outVideo);
        const videoDir = path.dirname(videoDest);
        if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

        const videoRes = await fetch(`${apiUrl}${run.result.videoUrl}`);
        if (videoRes.ok) {
          const buffer = Buffer.from(await videoRes.arrayBuffer());
          fs.writeFileSync(videoDest, buffer);
          console.log(`🎬 Downloaded Tutorial Video -> ${videoDest}`);
        }
      }

      break;
    } else if (run.status === 'failed') {
      console.error(`\n\n❌ Job Failed! Error: ${run.error}`);
      process.exit(1);
    }
  }
}
