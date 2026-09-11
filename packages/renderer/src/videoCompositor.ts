import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { VideoSegment, RenderOptions, RenderResult, AudioStem } from './types.js';

export class VideoCompositor {
  private defaultOptions: Required<RenderOptions> = {
    fps: 30,
    width: 1280,
    height: 800,
    paddingSeconds: 0.6,
    preRollSeconds: 0.8,
    postRollSeconds: 1.5,
  };

  /**
   * Render a single step's screenshot and audio into an MP4 video segment.
   */
  public renderSegment(
    stepIndex: number,
    edgeId: string,
    imagePath: string,
    audioStem: AudioStem,
    outputSegmentPath: string,
    options?: RenderOptions
  ): VideoSegment {
    const opts = { ...this.defaultOptions, ...options };
    const dir = path.dirname(outputSegmentPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const preRoll = opts.preRollSeconds ?? 1.0;
    const postRoll = opts.postRollSeconds ?? 2.0;
    const preRollMs = Math.round(preRoll * 1000);
    const speechDuration = Math.max(audioStem.durationSeconds, 4.0);
    const totalDuration = speechDuration + preRoll + postRoll;

    console.log(
      `[FFmpeg] Rendering step segment ${stepIndex} (${totalDuration.toFixed(1)}s: ${preRoll}s lead + ${speechDuration.toFixed(1)}s speech + ${postRoll}s hold)...`
    );

    // FFmpeg still-image encoding with audio sync:
    // adelay introduces silence before speech starts so viewer can inspect UI.
    // apad pads trailing silence so the video doesn't cut off immediately after speaking.
    const cmd = [
      'ffmpeg -y',
      `-loop 1 -framerate ${opts.fps} -i "${imagePath}"`,
      `-i "${audioStem.path}"`,
      `-af "adelay=${preRollMs}|${preRollMs},apad=pad_dur=${postRoll}"`,
      `-c:v libx264 -tune stillimage -preset fast -crf 20`,
      `-vf "scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2"`,
      `-c:a aac -b:a 192k -pix_fmt yuv420p`,
      `-t ${totalDuration.toFixed(2)}`,
      `"${outputSegmentPath}"`,
      '2>/dev/null',
    ].join(' ');

    execSync(cmd);

    return {
      stepIndex,
      edgeId,
      imagePath,
      audioStem,
      outputPath: outputSegmentPath,
      durationSeconds: totalDuration,
    };
  }

  /**
   * Concatenate multiple step video segments into a polished final walkthrough video.
   */
  public concatenateSegments(
    segments: VideoSegment[],
    finalOutputPath: string
  ): RenderResult {
    const dir = path.dirname(finalOutputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const listFilePath = path.join(dir, `concat_list_${Date.now()}.txt`);
    const fileEntries = segments.map((s) => `file '${path.resolve(s.outputPath)}'`).join('\n');
    fs.writeFileSync(listFilePath, fileEntries, 'utf-8');

    console.log(`\n[FFmpeg] Concatenating ${segments.length} segments into: ${finalOutputPath}`);

    // Concatenate via FFmpeg concat demuxer without re-encoding
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${finalOutputPath}" 2>/dev/null`;
    execSync(concatCmd);

    // Clean up temporary concat list
    if (fs.existsSync(listFilePath)) {
      fs.unlinkSync(listFilePath);
    }

    const totalDuration = segments.reduce((sum, s) => sum + s.durationSeconds, 0);

    return {
      outputPath: finalOutputPath,
      totalDurationSeconds: totalDuration,
      stepCount: segments.length,
      segments,
    };
  }
}
