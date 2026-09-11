import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowGraph, GraphEdge } from '@living-graph/extractor';
import { createVoiceSynthesizer } from './voiceSynthesizer.js';
import { VideoCompositor } from './videoCompositor.js';
import { VideoSegment } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Load root .env file if present
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

export async function runRenderer(): Promise<void> {
  const args = process.argv.slice(2);
  const isHeal = args.includes('--heal');
  const version = isHeal ? 'v2' : 'v1';

  console.log('\n======================================================');
  console.log('   LIVING GRAPH: STUDIO VOICEOVER & VIDEO COMPOSITOR');
  console.log(`   Target Workflow: Create High-Priority Ticket (${isHeal ? 'v2 Healed' : 'v1 Baseline'})`);
  console.log('======================================================\n');

  // Locate graph file
  const graphPath = path.resolve(__dirname, `../../extractor/output/workflow_graph_${version}.json`);
  if (!fs.existsSync(graphPath)) {
    console.error(`[ERROR] Workflow graph not found: ${graphPath}`);
    process.exit(1);
  }

  const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as WorkflowGraph;
  const edgeMap = new Map<string, GraphEdge>(graphData.edges.map((e: GraphEdge) => [e.id, e]));

  const workflowId = 'workflow_create_high_priority_ticket';
  const workflow = graphData.workflows.find((w) => w.id === workflowId);
  if (!workflow) {
    console.error(`[ERROR] Workflow ${workflowId} not found in graph.`);
    process.exit(1);
  }

  // Paths setup (prioritize version-specific trace directory)
  const versionTraceDir = path.resolve(__dirname, `../../walker/output/traces/${workflowId}/${version}`);
  const tracesDir = fs.existsSync(versionTraceDir) ? versionTraceDir : path.resolve(__dirname, `../../walker/output/traces/${workflowId}`);
  const audioOutputDir = path.resolve(__dirname, `../output/audio/${version}`);
  const segmentsOutputDir = path.resolve(__dirname, `../output/segments/${version}`);
  const finalVideoDir = path.resolve(__dirname, '../output/videos');

  [audioOutputDir, segmentsOutputDir, finalVideoDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const voiceSynthesizer = createVoiceSynthesizer();
  const compositor = new VideoCompositor();
  const renderedSegments: VideoSegment[] = [];

  // Generate video segment for each step
  for (let i = 0; i < workflow.edgeIds.length; i++) {
    const edgeId = workflow.edgeIds[i];
    const edge = edgeMap.get(edgeId);
    if (!edge) continue;

    console.log(`\n--- [PROCESSING STEP ${i + 1}/${workflow.edgeIds.length}] ---`);
    console.log(`Narration: "${edge.narration}"`);

    // 1. Locate screenshot
    let screenshotPath = path.join(tracesDir, `step_${i + 1}_${edge.id}.png`);
    if (!fs.existsSync(screenshotPath)) {
      // Fallback: search for matching step index or edge id
      const existingImages = fs.existsSync(tracesDir) ? fs.readdirSync(tracesDir).filter((f) => f.endsWith('.png')) : [];
      const matchByStep = existingImages.find((f) => f.startsWith(`step_${i + 1}_`));
      if (matchByStep) {
        screenshotPath = path.join(tracesDir, matchByStep);
      } else if (existingImages.length > 0) {
        screenshotPath = path.join(tracesDir, existingImages[Math.min(i, existingImages.length - 1)]);
      }
    }

    // 2. Synthesize voice stem
    const audioPath = path.join(audioOutputDir, `step_${i + 1}.m4a`);
    const audioStem = await voiceSynthesizer.synthesize(edge.narration, audioPath);

    // 3. Render video segment
    const segmentPath = path.join(segmentsOutputDir, `segment_${i + 1}.mp4`);
    const segment = compositor.renderSegment(i + 1, edge.id, screenshotPath, audioStem, segmentPath);
    renderedSegments.push(segment);
  }

  // 4. Assemble final tutorial video
  const outputFileName = `tutorial_create_ticket_${version}${isHeal ? '_healed' : ''}.mp4`;
  const finalVideoPath = path.join(finalVideoDir, outputFileName);

  const result = compositor.concatenateSegments(renderedSegments, finalVideoPath);

  console.log('\n======================================================');
  console.log('   TUTORIAL VIDEO ASSEMBLY COMPLETE');
  console.log(`   Output File:     ${result.outputPath}`);
  console.log(`   Total Duration:  ${result.totalDurationSeconds.toFixed(1)} seconds`);
  console.log(`   Steps Included:  ${result.stepCount}`);
  console.log('======================================================\n');
}

export {
  createVoiceSynthesizer,
  GoogleGeminiTtsSynthesizer,
  ElevenLabsSynthesizer,
  LocalMacSynthesizer,
  createWavHeader,
} from './voiceSynthesizer.js';
export { VideoCompositor } from './videoCompositor.js';
export { renderNarratedVideo, NarratedStep } from './narratedVideo.js';
export * from './types.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runRenderer().catch((err) => {
    console.error('[RENDERER FATAL ERROR]', err);
    process.exit(1);
  });
}
