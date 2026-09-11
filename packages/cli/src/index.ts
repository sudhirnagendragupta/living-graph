import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { extractCommand } from './commands/extract.js';
import { diffCommand } from './commands/diff.js';
import { dispatchCommand } from './commands/dispatch.js';
import { recordCommand } from './commands/record.js';
import { agenticWalkCommand } from './commands/agenticWalk.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load a root .env file if present, same convention as apps/api and
// packages/renderer — so GEMINI_API_KEY / NVIDIA_API_KEY set once at the
// repo root work for the CLI too, not just the server processes.
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

const program = new Command();

program
  .name('living-graph')
  .description('Living Graph CLI: Self-Healing Product Documentation & E2E Test Triad')
  .version('0.1.0');

// 1. record (Extract + Topic Discovery + Interactive Curation + Walk + Bundle)
program
  .command('record')
  .description('Extract AST, curate topics, walk local app, and package ready-to-upload bundle.zip')
  .option('-o, --out <path>', 'Destination directory or path for generated topic bundles', './output/bundles')
  .option('-u, --url <url>', 'Target application URL', 'http://localhost:5173')
  .option('-v, --ui-version <version>', 'Target UI version flag (v1 or v2)', 'v2')
  .option('-s, --src <path>', 'Path to target source code directory to scan')
  .option('-t, --topics <topics>', 'Comma-separated topic numbers or names, or "all" to skip prompt')
  .option('--all', 'Select all candidate topics automatically')
  .option('-a, --api <url>', 'Living Graph Cloud API URL for topic discovery', process.env.LIVING_GRAPH_API_URL || 'http://localhost:3000')
  .option('-k, --api-key <key>', 'API key for authenticated Cloud Run communication')
  .option('-p, --push', 'Automatically push generated bundle(s) to Living Graph Cloud')
  .option('--project <id>', 'Target project ID for cloud bundle ingestion', 'default')
  .option('--skip-walk', 'Skip launching browser and bundle only graph and topic definitions')
  .option('-e, --engine <engine>', 'Walk engine: "deterministic" (scripted AST replay, self-healing) or "agentic" (Claude computer-use, goal-driven)', 'deterministic')
  .option('--max-steps <n>', 'Max turns per topic for the agentic engine', '15')
  .action(async (options) => {
    await recordCommand(options);
  });

// 2. extract
program
  .command('extract')
  .description('Extract the static AST state-machine graph from React/Vue/SaaS source code')
  .option('-o, --out <path>', 'Path to output graph JSON file')
  .option('-v, --ui-version <version>', 'Target UI version to extract (v1 or v2)', 'v1')
  .option('-s, --src <path>', 'Path to target source code directory to scan')
  .action(async (options) => {
    await extractCommand(options);
  });

// 3. diff
program
  .command('diff')
  .description('Inspect structural and visual drift between two UI graphs')
  .argument('<v1>', 'Path to baseline v1 graph JSON')
  .argument('<v2>', 'Path to redesign v2 graph JSON')
  .option('-o, --out <path>', 'Optional path to output JSON drift report')
  .action(async (v1, v2, options) => {
    await diffCommand(v1, v2, options);
  });

// 4. dispatch
program
  .command('dispatch')
  .description('Dispatch a workflow graph to the Living Graph Cloud API for autonomous walking, healing, and rendering')
  .requiredOption('-u, --preview-url <url>', 'Public or local staging/preview URL of the application')
  .option('-g, --graph <path>', 'Path to workflow graph JSON file', 'workflow_graph_v2.json')
  .option('-w, --workflow <id>', 'Specific workflow ID to execute')
  .option('-v, --ui-version <version>', 'Target UI version flag (v1 or v2)', 'v2')
  .option('-a, --api <url>', 'Living Graph Cloud API URL', process.env.LIVING_GRAPH_API_URL || 'http://localhost:3000')
  .option('-k, --api-key <key>', 'API key for authenticated Cloud Run communication')
  .option('--wait', 'Block and poll until execution finishes')
  .option('--out-spec <path>', 'Destination to save generated/healed Playwright .spec.ts file')
  .option('--out-video <path>', 'Destination to download rendered .mp4 tutorial video')
  .option('-e, --engine <engine>', 'Walk engine: "deterministic" (scripted AST replay, self-healing) or "agentic" (Claude computer-use, goal-driven)', 'deterministic')
  .option('--goal <text>', 'Agentic engine only: plain-English goal (defaults to the target workflow\'s title + description)')
  .option('--max-steps <n>', 'Agentic engine only: max turns before giving up')
  .action(async (options) => {
    await dispatchCommand(options);
  });

// 5. agentic-walk
program
  .command('agentic-walk')
  .description('Drive the browser toward a plain-English goal using Claude\'s native computer-use tool (no pre-computed script, no DOM grounding)')
  .requiredOption('-g, --goal <text>', 'Plain-English goal to accomplish, e.g. "Invite a new teammate named Jane Doe with email jane@example.com"')
  .option('-u, --url <url>', 'Target application base URL', 'http://localhost:5173')
  .option('-s, --start-path <path>', 'Route to start from, e.g. /settings', '/')
  .option('--max-steps <n>', 'Maximum steps before giving up', '12')
  .action(async (options) => {
    await agenticWalkCommand(options);
  });

program.parse(process.argv);

