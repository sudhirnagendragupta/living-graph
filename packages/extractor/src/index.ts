import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GraphBuilder } from './graphBuilder.js';

export * from './types.js';
export * from './graphBuilder.js';
export * from './codebaseScanner.js';
export * from './semanticNarration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runExtractor(): Promise<void> {
  const args = process.argv.slice(2);
  const srcArg = args.find((a) => a.startsWith('--src='));
  const srcDir = srcArg ? srcArg.split('=')[1] : undefined;

  // --prev= for diff: path to a previous graph JSON
  const prevArg = args.find((a) => a.startsWith('--prev='));
  const prevGraphPath = prevArg ? prevArg.split('=')[1] : undefined;

  console.log('\n======================================================');
  console.log('   LIVING GRAPH: UI STATE EXTRACTOR & GRAPH COMPILER');
  console.log('======================================================\n');

  const builder = new GraphBuilder(srcDir);

  // Build graph for the current codebase state
  const graph = await builder.buildGraph();

  console.log(`\n[INFO] Graph: ${Object.keys(graph.nodes).length} route nodes, ${Object.keys(graph.stateNodes).length} state nodes`);
  console.log(`[INFO] Edges: ${graph.edges.length} total (${graph.stateEdges.length} intra-page)`);
  console.log(`[INFO] Workflows: ${graph.workflows.length} discovered and enriched`);

  // Ensure output directory
  const outputDir = path.resolve(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write graph JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const graphPath = path.join(outputDir, `graph_${timestamp}.json`);
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');

  // Also write a stable graph.json for CLI/Cloud consumption
  const stablePath = path.join(outputDir, 'graph.json');
  fs.writeFileSync(stablePath, JSON.stringify(graph, null, 2), 'utf-8');

  console.log(`\n[SUCCESS] Emitted Graph -> ${graphPath}`);
  console.log(`[SUCCESS] Emitted Graph -> ${stablePath} (stable symlink)`);

  // Optional: compute diff against a previous graph
  if (prevGraphPath && fs.existsSync(prevGraphPath)) {
    const prevGraph = JSON.parse(fs.readFileSync(prevGraphPath, 'utf-8'));
    const diff = builder.computeDiff(prevGraph, graph);
    const diffPath = path.join(outputDir, `diff_${timestamp}.json`);
    fs.writeFileSync(diffPath, JSON.stringify(diff, null, 2), 'utf-8');

    console.log('\n------------------------------------------------------');
    console.log('   GRAPH DIFF REPORT (previous vs current)');
    console.log('------------------------------------------------------');
    console.log(`• Changes detected:   ${diff.hasChanges ? 'YES' : 'NO'}`);
    console.log(`• New topics:         ${diff.workflowDiffs.filter((w) => w.status === 'new').length}`);
    console.log(`• Changed topics:     ${diff.workflowDiffs.filter((w) => w.status === 'changed').length}`);
    console.log(`• Removed topics:     ${diff.workflowDiffs.filter((w) => w.status === 'removed').length}`);
    console.log(`• Stable topics:      ${diff.workflowDiffs.filter((w) => w.status === 'stable').length}`);
    console.log(`\n[SUCCESS] Emitted Diff Report -> ${diffPath}`);
  }

  // Print workflow summary
  console.log('\n[WORKFLOWS DISCOVERED]:');
  for (const wf of graph.workflows) {
    const branch = wf.branchCondition ? ` [${wf.branchCondition}]` : '';
    console.log(`  • [${wf.priority}] ${wf.title}${branch}`);
    console.log(`    ${wf.description}`);
    console.log(`    Steps: ${wf.steps.length} | Difficulty: ${wf.difficulty} | Persona: ${wf.persona ?? 'General'}`);
  }

  console.log('\n======================================================\n');
}

// CLI Execution if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runExtractor().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}
