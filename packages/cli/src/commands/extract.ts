import * as fs from 'fs';
import * as path from 'path';
import { GraphBuilder } from '@living-graph/extractor';

export interface ExtractOptions {
  out?: string;
  uiVersion?: 'v1' | 'v2';
  src?: string;
}

export async function extractCommand(options: ExtractOptions): Promise<void> {
  const version = options.uiVersion || 'v1';
  const outputPath = path.resolve(process.cwd(), options.out || `workflow_graph_${version}.json`);

  console.log('\n======================================================');
  console.log('   LIVING GRAPH CLI: STATIC AST & SITEMAP EXTRACTOR');
  console.log('======================================================\n');
  console.log(`Target UI Version: ${version}`);
  if (options.src) {
    console.log(`Source Directory:  ${options.src}`);
  }

  let builder: GraphBuilder;
  try {
    builder = new GraphBuilder(options.src);
  } catch (err: any) {
    console.error(`\n[ERROR] ${err.message}`);
    process.exit(1);
  }
  const graph = await builder.buildGraph();
  if (options.uiVersion) {
    graph.version = options.uiVersion;
  }

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2), 'utf-8');

  console.log(`\n✅ Graph Extracted Successfully:`);
  console.log(`   • Nodes:      ${Object.keys(graph.nodes).length}`);
  console.log(`   • Edges:      ${graph.edges.length}`);
  console.log(`   • Workflows:  ${graph.workflows.length}`);
  console.log(`   • Artifact:   ${outputPath}\n`);
}
