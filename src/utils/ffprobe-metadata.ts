import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_FFPROBE_BINARY = 'ffprobe';
const FFPROBE_TIMEOUT_MS = 15000;

export interface OutputMetadata {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

export class FfprobeMetadataError extends Error {
  constructor(message: string, context?: Record<string, unknown>) {
    super(context ? `${message} ${JSON.stringify(context)}` : message);
    this.name = 'FfprobeMetadataError';
  }
}

/**
 * Reuses no prior work — none existed (confirmed: `ffprobe` only ever
 * appeared as a comment describing manual, out-of-band verification during
 * Faz 8A testing, never invoked from code). Shells out to a real `ffprobe`
 * binary (assumed present on PATH — same assumption this repo already
 * makes about `osascript`; no bundled binary is shipped) and parses its
 * `-print_format json` output. A parseable `r_frame_rate`/`avg_frame_rate`
 * like "30000/1001" is reduced to a plain decimal since nothing downstream
 * needs the exact rational form.
 */
export async function collectOutputMetadata(
  filePath: string,
  ffprobeBinary: string = DEFAULT_FFPROBE_BINARY,
): Promise<OutputMetadata> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      ffprobeBinary,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: FFPROBE_TIMEOUT_MS },
    );
    stdout = result.stdout;
  } catch (error) {
    throw new FfprobeMetadataError('ffprobe çalıştırılamadı', {
      filePath,
      error: (error as Error).message,
    });
  }

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch (error) {
    throw new FfprobeMetadataError('ffprobe çıktısı JSON olarak ayrıştırılamadı', {
      filePath,
      error: (error as Error).message,
    });
  }

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio');

  const resolvedDuration = Number(parsed.format?.duration);

  return {
    durationSeconds: Number.isFinite(resolvedDuration) ? resolvedDuration : 0,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    frameRate: parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
    videoCodec: videoStream?.codec_name ?? null,
    hasAudio,
  };
}

function parseFrameRate(rational: string | undefined): number | null {
  if (!rational) {
    return null;
  }
  const parts = rational.split('/').map(Number);
  const numerator = parts[0];
  const denominator = parts[1];
  if (
    numerator === undefined ||
    denominator === undefined ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}
