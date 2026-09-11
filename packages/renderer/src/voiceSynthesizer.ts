import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AudioStem, IVoiceSynthesizer } from './types.js';

/**
 * Get duration of an audio file in seconds using ffprobe.
 */
export function getAudioDuration(audioPath: string): number {
  try {
    const stdout = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
      { encoding: 'utf-8' }
    );
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) || duration <= 0 ? 3.0 : duration;
  } catch {
    return 3.5; // Safe default duration
  }
}

/**
 * ElevenLabs Studio Speech Synthesizer.
 */
export class ElevenLabsSynthesizer implements IVoiceSynthesizer {
  private apiKey: string;
  private voiceId: string;

  constructor(apiKey?: string, voiceId?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
    // Default to 'Rachel' (warm, clear professional narration)
    this.voiceId = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  }

  public async synthesize(text: string, outputPath: string): Promise<AudioStem> {
    if (!this.apiKey) {
      console.warn('[ElevenLabs] ELEVENLABS_API_KEY not configured. Falling back to local synthesizer.');
      const local = new LocalMacSynthesizer();
      return local.synthesize(text, outputPath);
    }

    console.log(`[ElevenLabs] Synthesizing speech stem: "${text.substring(0, 50)}..."`);
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[ElevenLabs] Synthesis failed (${response.status}): ${err}. Falling back to local speech.`);
      const local = new LocalMacSynthesizer();
      return local.synthesize(text, outputPath);
    }

    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

    const durationSeconds = getAudioDuration(outputPath);
    console.log(`[ElevenLabs] Voice stem saved -> ${path.basename(outputPath)} (${durationSeconds.toFixed(1)}s)`);

    return {
      path: outputPath,
      durationSeconds,
      narration: text,
    };
  }
}

/**
 * Local Speech Synthesizer (Zero API credits needed).
 * Uses macOS native 'say' on Darwin, or generates calibrated synthetic silence
 * when running headless on Linux/CI without cloud TTS credentials.
 */
export class LocalMacSynthesizer implements IVoiceSynthesizer {
  public async synthesize(text: string, outputPath: string): Promise<AudioStem> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const isMac = process.platform === 'darwin';
    const tempAiff = path.join(dir, `temp_${Date.now()}.aiff`);

    if (isMac) {
      try {
        console.log(`[LocalTTS] Generating macOS native voice narration: "${text.substring(0, 50)}..."`);
        execSync(`say -r 140 -v Samantha -o "${tempAiff}" "${text.replace(/"/g, '\\"')}"`);
        execSync(`ffmpeg -y -i "${tempAiff}" -c:a aac -b:a 192k "${outputPath}" 2>/dev/null`);
      } catch {
        this.generateSyntheticStem(outputPath);
      } finally {
        if (fs.existsSync(tempAiff)) {
          fs.unlinkSync(tempAiff);
        }
      }
    } else {
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const estDuration = Math.max(4.5, Math.ceil(wordCount / 2.3));
      console.warn(`[LocalTTS] NOTICE: Local speech synthesis via macOS "say" is unavailable on Linux/CI. Generating ${estDuration}s audio stem.`);
      this.generateSyntheticStem(outputPath, estDuration);
    }

    const durationSeconds = getAudioDuration(outputPath);
    console.log(`[LocalTTS] Voice stem saved -> ${path.basename(outputPath)} (${durationSeconds.toFixed(1)}s)`);

    return {
      path: outputPath,
      durationSeconds,
      narration: text,
    };
  }

  private generateSyntheticStem(outputPath: string, durationSeconds: number = 4.0): void {
    try {
      // Generate a pleasant dual-frequency harmonic tone instead of silence
      execSync(
        `ffmpeg -y -f lavfi -i "sine=frequency=523.25:duration=${durationSeconds}" -af "volume=0.25" -c:a aac -b:a 128k "${outputPath}" 2>/dev/null`
      );
    } catch {
      // Fallback in case lavfi fails
      execSync(
        `ffmpeg -y -f lavfi -i "sine=frequency=440:duration=${durationSeconds}" -c:a aac "${outputPath}" 2>/dev/null`
      );
    }
  }
}

/**
 * Creates a standard 44-byte WAV header for LINEAR16 PCM audio.
 */
export function createWavHeader(dataLength: number, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Resolves a valid Google Cloud OAuth2 access token.
 * Works seamlessly in Google Cloud Run (metadata server) and developer workstations (gcloud).
 */
export async function getGoogleCloudAccessToken(): Promise<string | null> {
  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN;
  }

  // 1. Cloud Run / Compute Engine metadata server
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data.access_token) {
        return data.access_token;
      }
    }
  } catch {}

  // 2. Local developer workstation (gcloud CLI)
  try {
    const token = execSync('gcloud auth print-access-token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (token && token.startsWith('ya29.')) return token;
  } catch {}

  return null;
}

export interface GoogleTtsOptions {
  apiKey?: string;
  voiceName?: string;
  prompt?: string;
  speakingRate?: number;
  pitch?: number;
}

export function resolveGoogleTtsVoice(voiceName?: string): string {
  if (!voiceName) return 'en-US-Chirp3-HD-Achernar';
  if (voiceName.startsWith('en-US-')) return voiceName;

  const map: Record<string, string> = {
    Achernar: 'en-US-Chirp3-HD-Achernar',
    Aoede: 'en-US-Chirp3-HD-Aoede',
    Puck: 'en-US-Chirp3-HD-Puck',
    Charon: 'en-US-Chirp3-HD-Charon',
    Fenrir: 'en-US-Chirp3-HD-Fenrir',
    Kore: 'en-US-Chirp3-HD-Kore',
  };
  return map[voiceName] || `en-US-Chirp3-HD-${voiceName}`;
}

/**
 * Google Cloud Text-to-Speech Synthesizer using Google Chirp3 HD / Neural2 Voices.
 */
export class GoogleGeminiTtsSynthesizer implements IVoiceSynthesizer {
  private voiceName: string;
  private speakingRate: number;
  private pitch: number;

  constructor(options?: GoogleTtsOptions) {
    this.voiceName = resolveGoogleTtsVoice(options?.voiceName || process.env.GOOGLE_TTS_VOICE);
    this.speakingRate = options?.speakingRate ?? 0.95;
    this.pitch = options?.pitch ?? 0.0;
  }

  public async synthesize(text: string, outputPath: string): Promise<AudioStem> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const accessToken = await getGoogleCloudAccessToken();

    if (accessToken) {
      try {
        console.log(`[GoogleCloudTTS] Synthesizing voiceover via Google Neural2 (${this.voiceName}): "${text.substring(0, 60)}..."`);
        const endpoint = 'https://texttospeech.googleapis.com/v1/text:synthesize';
        const payload = {
          input: { text },
          voice: {
            languageCode: 'en-US',
            name: this.voiceName,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: this.speakingRate,
            pitch: this.pitch,
          },
        };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'X-Goog-User-Project': process.env.GOOGLE_CLOUD_PROJECT || 'ml-engineer-463401',
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = (await response.json()) as { audioContent: string };
          const mp3Buffer = Buffer.from(data.audioContent, 'base64');
          const tempMp3 = path.join(dir, `temp_tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
          fs.writeFileSync(tempMp3, mp3Buffer);

          // Transcode mp3 to target audio format (aac m4a) via ffmpeg
          execSync(`ffmpeg -y -i "${tempMp3}" -c:a aac -b:a 192k "${outputPath}" 2>/dev/null`);
          try { fs.unlinkSync(tempMp3); } catch {}

          const durationSeconds = getAudioDuration(outputPath);
          console.log(`✔ [GoogleCloudTTS] Neural speech stem saved -> ${path.basename(outputPath)} (${durationSeconds.toFixed(1)}s)`);

          return {
            path: outputPath,
            durationSeconds,
            narration: text,
          };
        } else {
          const errText = await response.text();
          console.warn(`[GoogleCloudTTS] API call returned ${response.status}: ${errText}`);
        }
      } catch (err: any) {
        console.warn(`[GoogleCloudTTS] Synthesis error: ${err.message}`);
      }
    } else {
      console.warn('[GoogleCloudTTS] No GCP access token found. Falling back to local synthesizer.');
    }

    // Fallback if cloud TTS unavailable
    const local = new LocalMacSynthesizer();
    return local.synthesize(text, outputPath);
  }

  public async synthesizeRaw(text: string): Promise<{ audioBase64: string; mimeType: string }> {
    const accessToken = await getGoogleCloudAccessToken();
    if (!accessToken) {
      throw new Error('GCP access token required for Google TTS synthesis');
    }

    const endpoint = 'https://texttospeech.googleapis.com/v1/text:synthesize';
    const payload = {
      input: { text },
      voice: {
        languageCode: 'en-US',
        name: this.voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: this.speakingRate,
        pitch: this.pitch,
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Goog-User-Project': process.env.GOOGLE_CLOUD_PROJECT || 'ml-engineer-463401',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google TTS error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as { audioContent: string };
    return {
      audioBase64: data.audioContent,
      mimeType: 'audio/mp3',
    };
  }
}

/**
 * Factory creating the appropriate speech synthesizer.
 */
export function createVoiceSynthesizer(): IVoiceSynthesizer {
  if (process.env.ELEVENLABS_API_KEY) {
    return new ElevenLabsSynthesizer();
  }
  // Default to Google Cloud Neural2 TTS with automatic token discovery
  return new GoogleGeminiTtsSynthesizer();
}
