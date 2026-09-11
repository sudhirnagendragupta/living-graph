import * as fs from 'fs';
import * as path from 'path';
import { createVoiceSynthesizer } from './voiceSynthesizer.js';
import { VideoCompositor } from './videoCompositor.js';
import { VideoSegment, RenderResult } from './types.js';

export interface NarratedStep {
  stepIndex: number;
  edgeId: string;
  narration: string;
  imagePath: string;
}

/**
 * Turns a flat list of narrated screenshot steps into a single narrated
 * .mp4 — the voiceover-synthesis + per-step-segment + concatenate loop that
 * used to be copy-pasted across renderer/index.ts, jobManager.ts, and
 * routes.ts. Engine-agnostic: it only needs {narration, imagePath} pairs,
 * so both AutonomousWalker's StepTrace[] and ComputerUseWalker's
 * AgenticReplayStep[] (via a trivial field rename) feed it identically.
 */
export async function renderNarratedVideo(
  steps: NarratedStep[],
  outputVideoPath: string,
  workDirs: { audioDir: string; segmentsDir: string }
): Promise<RenderResult> {
  const { audioDir, segmentsDir } = workDirs;
  [audioDir, segmentsDir, path.dirname(outputVideoPath)].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const voiceSynthesizer = createVoiceSynthesizer();
  const compositor = new VideoCompositor();
  const renderedSegments: VideoSegment[] = [];

  for (const step of steps) {
    const audioPath = path.join(audioDir, `step_${step.stepIndex}.m4a`);
    const audioStem = await voiceSynthesizer.synthesize(step.narration, audioPath);

    const segmentPath = path.join(segmentsDir, `segment_${step.stepIndex}.mp4`);
    const segment = compositor.renderSegment(step.stepIndex, step.edgeId, step.imagePath, audioStem, segmentPath);
    renderedSegments.push(segment);
  }

  return compositor.concatenateSegments(renderedSegments, outputVideoPath);
}
