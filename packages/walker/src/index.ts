import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowGraph } from '@living-graph/extractor';
import { createVerifierClient } from '@living-graph/verifier';
import { AutonomousWalker } from './walker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env file if present
const rootEnvPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(rootEnvPath)) {
  const content = fs.readFileSync(rootEnvPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [k, ...v] = trimmed.split('=');
      const key = k.trim();
      if (!process.env[key]) {
        process.env[key] = v.join('=').trim().replace(/(^['"]|['"]$)/g, '');
      }
    }
  }
}

async function ensureDesklyRunning(baseUrl: string = 'http://localhost:5173'): Promise<any> {
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
    if (res.ok || res.status < 500) return null;
  } catch {}

  const desklyDir = path.resolve(__dirname, '../../../apps/deskly');
  console.log(`[WALKER] Starting Deskly on ${baseUrl}...`);
  const { spawn } = await import('child_process');
  const proc = spawn('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], {
    cwd: desklyDir,
    shell: true,
    stdio: 'ignore',
  });

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status < 500) {
        console.log(`✔ Deskly server is ready at ${baseUrl}`);
        return proc;
      }
    } catch {}
  }
  return proc;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isHeal = args.includes('--heal');
  const versionArg = args.find((a) => a.startsWith('--version='))?.split('=')[1] as 'v1' | 'v2' | undefined;
  const version = versionArg || (isHeal ? 'v1' : 'v2');
  const targetWorkflowArg = args.find((a) => a.startsWith('--workflow='))?.split('=')[1];
  const walkAll = args.includes('--all') || !targetWorkflowArg;

  // Locate graph file
  const graphFileName = `workflow_graph_${version}.json`;
  const graphPath = path.resolve(__dirname, '../../extractor/output', graphFileName);

  if (!fs.existsSync(graphPath)) {
    console.error(`[ERROR] Workflow graph file not found: ${graphPath}`);
    console.error('Please run "npm run extract:graph" first.');
    process.exit(1);
  }

  const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as WorkflowGraph;
  const serverProc = await ensureDesklyRunning('http://localhost:5173');

  try {
    const verifier = createVerifierClient();
    const walker = new AutonomousWalker(verifier, 'http://localhost:5173');

    const workflowsToWalk = walkAll
      ? graphData.workflows
      : graphData.workflows.filter((w) => w.id === targetWorkflowArg);

    for (const wf of workflowsToWalk) {
      console.log(`\n======================================================`);
      console.log(`[MODE: STANDARD WALK (${version})] - ${wf.id} (${wf.edgeIds.length} steps)`);
      console.log(`======================================================`);
      const result = await walker.walkWorkflow(graphData, wf.id, {
        enableSelfHealing: false,
        uiVersion: version,
      });
      console.log(`✔ Finished ${wf.id}: ${result.verifiedSteps}/${result.totalSteps} steps verified.`);
    }

    // Also walk v1 workflows if --version=all or --both
    if (args.includes('--both')) {
      const v1GraphPath = path.resolve(__dirname, '../../extractor/output/workflow_graph_v1.json');
      if (fs.existsSync(v1GraphPath)) {
        const v1Graph = JSON.parse(fs.readFileSync(v1GraphPath, 'utf-8')) as WorkflowGraph;
        for (const wf of v1Graph.workflows) {
          console.log(`\n======================================================`);
          console.log(`[MODE: STANDARD WALK (v1)] - ${wf.id} (${wf.edgeIds.length} steps)`);
          console.log(`======================================================`);
          await walker.walkWorkflow(v1Graph, wf.id, {
            enableSelfHealing: false,
            uiVersion: 'v1',
          });
        }
      }
    }
  } finally {
    if (serverProc) {
      try {
        serverProc.kill();
      } catch {}
    }
  }
}

export { AutonomousWalker, WalkResult, StepTrace } from './walker.js';
export { AutonomousHealer } from './healer.js';
export { TestGenerator } from './testGenerator.js';
export { ComputerUseWalker, ComputerUseWalkResult, ComputerUseActionTrace } from './computerUseWalker.js';
export { buildAgenticReplayArtifacts, AgenticReplayArtifacts, AgenticReplayStep } from './agenticReplay.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[WALKER FATAL ERROR]', err);
    process.exit(1);
  });
}
