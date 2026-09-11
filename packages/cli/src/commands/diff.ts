import * as fs from 'fs';
import * as path from 'path';
import { GraphBuilder, WorkflowGraph } from '@living-graph/extractor';

export async function diffCommand(v1File: string, v2File: string, options?: { out?: string }): Promise<void> {
  const v1Path = path.resolve(process.cwd(), v1File);
  const v2Path = path.resolve(process.cwd(), v2File);

  if (!fs.existsSync(v1Path)) {
    console.error(`[ERROR] v1 graph file not found: ${v1Path}`);
    process.exit(1);
  }
  if (!fs.existsSync(v2Path)) {
    console.error(`[ERROR] v2 graph file not found: ${v2Path}`);
    process.exit(1);
  }

  const v1Graph: WorkflowGraph = JSON.parse(fs.readFileSync(v1Path, 'utf-8'));
  const v2Graph: WorkflowGraph = JSON.parse(fs.readFileSync(v2Path, 'utf-8'));

  const builder = new GraphBuilder();
  const diff = builder.computeDiff(v1Graph, v2Graph);

  console.log('\n======================================================');
  console.log('   LIVING GRAPH CLI: TOPOLOGICAL DRIFT INSPECTOR');
  console.log('======================================================\n');
  console.log(`• Drift Detected:     ${diff.driftDetected ? '⚠️  YES (Regression / Layout Change)' : '✅ NO'}`);
  console.log(`• Newly Added Nodes:  ${diff.addedNodes.length > 0 ? diff.addedNodes.join(', ') : 'None'}`);
  console.log(`• Removed Nodes:      ${diff.removedNodes.length > 0 ? diff.removedNodes.join(', ') : 'None'}`);
  console.log(`• Broken v1 Edges:    ${diff.brokenEdges.length} (${diff.brokenEdges.map((e) => e.id).join(', ') || 'None'})`);
  console.log(`• New v2 Edges:       ${diff.addedEdges.length} (${diff.addedEdges.map((e) => e.id).join(', ') || 'None'})`);

  if (diff.affectedWorkflows.length > 0) {
    console.log('\n[AFFECTED WORKFLOWS SCHEDULED FOR VLM HEALING]:');
    for (const wf of diff.affectedWorkflows) {
      console.log(`  ⚡ "${wf.title}" (${wf.workflowId})`);
      console.log(`     Reason:        ${wf.driftReason}`);
      console.log(`     v1 Trajectory: ${wf.v1Path.join(' -> ')}`);
      console.log(`     v2 Trajectory: ${wf.v2Path.join(' -> ')}`);
    }
  }

  if (options?.out) {
    const outPath = path.resolve(process.cwd(), options.out);
    fs.writeFileSync(outPath, JSON.stringify(diff, null, 2), 'utf-8');
    console.log(`\nEmitted drift report -> ${outPath}`);
  }

  console.log('\n======================================================\n');
}
