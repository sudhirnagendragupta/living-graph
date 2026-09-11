export interface AudioStem {
  path: string;
  durationSeconds: number;
  narration: string;
}

export interface VideoSegment {
  stepIndex: number;
  edgeId: string;
  imagePath: string;
  audioStem: AudioStem;
  outputPath: string;
  durationSeconds: number;
}

export interface RenderOptions {
  fps?: number;
  width?: number;
  height?: number;
  paddingSeconds?: number;
  preRollSeconds?: number;
  postRollSeconds?: number;
}

export interface RenderResult {
  outputPath: string;
  totalDurationSeconds: number;
  stepCount: number;
  segments: VideoSegment[];
}

export interface IVoiceSynthesizer {
  synthesize(text: string, outputPath: string): Promise<AudioStem>;
}
