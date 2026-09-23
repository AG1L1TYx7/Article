import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Re-encoding uploaded video and audio with ffmpeg.
 *
 * The counterpart to what sharp does for images. An uploaded video is
 * whatever container and codec the author's phone produced — a .mov of
 * HEVC plays in Safari and nowhere else — and it carries metadata,
 * including the location it was filmed. Transcoding to H.264/AAC in MP4
 * (or MP3 for audio) normalises playback and drops everything not
 * explicitly copied. Because ffmpeg writes a fresh file from decoded
 * frames, the bytes served are never the bytes uploaded: a file crafted
 * to be two things at once (a valid video that is also something a
 * browser would execute) does not survive the round trip. That is why
 * lib/mediaPipeline.ts treats a transcoded file as publishable even
 * without a malware scanner, exactly as it treats a sharp re-encode.
 *
 * Which ffmpeg: FFMPEG_PATH when set (the Docker image points it at the
 * distribution's package), otherwise the binary the `ffmpeg-static`
 * package downloads for this platform at install time, so a laptop and a
 * cPanel host get it without a system install. Nothing configured, or a
 * binary that is not there, and this reports "unavailable".
 */

/** Generous, but bounded: a hung ffmpeg must not hold a request forever. */
const TIMEOUT_MS = 10 * 60 * 1000;

export type TranscodeResult =
  | { status: "ok"; data: Buffer; contentType: string; ext: string; durationSecs: number | null }
  /** Not configured. The caller keeps the original. */
  | { status: "unavailable" }
  | { status: "error"; reason: string };

let bundledPath: string | null | undefined;

/** The ffmpeg-static binary, if the package and its download are present. */
function bundledFfmpeg(): string | null {
  if (bundledPath !== undefined) return bundledPath;
  try {
    const require = createRequire(import.meta.url);
    const p = require("ffmpeg-static") as string | null;
    bundledPath = p && existsSync(p) ? p : null;
  } catch {
    bundledPath = null;
  }
  return bundledPath;
}

/** The binary to run, or null when there is none. */
export function ffmpegPath(): string | null {
  const configured = process.env.FFMPEG_PATH;
  if (configured) return configured;
  return bundledFfmpeg();
}

export function isTranscodingConfigured(): boolean {
  return ffmpegPath() !== null;
}

/**
 * The arguments ffmpeg is invoked with for video.
 *
 * Exported so the encoding decisions are visible in a test rather than
 * buried in a spawn call.
 */
export function ffmpegArgs(input: string, output: string): string[] {
  return [
    // Never prompt; a prompt on a server is a hang.
    "-nostdin",
    "-y",
    "-i",
    input,
    "-c:v",
    "libx264",
    // Widely compatible profile rather than the best possible quality:
    // this has to play on an old Android phone, not win an encoding
    // contest.
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    // Drops every metadata stream the source carried — including the GPS
    // coordinates a phone records, which a newsroom really should not be
    // republishing by accident.
    "-map_metadata",
    "-1",
    // Puts the index at the front so playback can start before the whole
    // file has downloaded. Without it a viewer waits for the entire video.
    "-movflags",
    "+faststart",
    output,
  ];
}

/**
 * The arguments for audio: MP3 at 128 kbit/s, joint stereo.
 *
 * MP3 rather than AAC/M4A because it is the one format every browser,
 * podcast app and feed reader plays, and the RSS feed offers audio as an
 * enclosure. `-vn` discards embedded cover art, which is a second file
 * (usually a JPEG) riding inside the first — exactly the kind of thing
 * this pipeline exists to leave behind.
 */
export function ffmpegAudioArgs(input: string, output: string): string[] {
  return [
    "-nostdin",
    "-y",
    "-i",
    input,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-map_metadata",
    "-1",
    "-id3v2_version",
    "0",
    output,
  ];
}

/**
 * The length of what ffmpeg just wrote, read from its own progress
 * output: the last "time=HH:MM:SS.ss" it printed is the output's
 * duration. ffmpeg-static does not ship ffprobe, and a second decode just
 * to ask the length would double the work.
 */
export function durationFromFfmpegLog(stderr: string): number | null {
  const matches = stderr.match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return null;
  const last = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(matches[matches.length - 1]!)!;
  const secs = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  return Number.isFinite(secs) ? Math.round(secs) : null;
}

/**
 * Transcodes a video. Never throws — every failure is a returned status.
 *
 * Works through temporary files rather than pipes: ffmpeg cannot write MP4
 * to a non-seekable output, because +faststart rewrites the header after
 * the body is complete.
 */
export function transcodeVideo(input: Buffer, ext: string): Promise<TranscodeResult> {
  return transcode(input, ext, "output.mp4", ffmpegArgs, "video/mp4", "mp4");
}

/** Transcodes audio to MP3. Same contract as transcodeVideo. */
export function transcodeAudio(input: Buffer, ext: string): Promise<TranscodeResult> {
  return transcode(input, ext, "output.mp3", ffmpegAudioArgs, "audio/mpeg", "mp3");
}

async function transcode(
  input: Buffer,
  ext: string,
  outputName: string,
  args: (input: string, output: string) => string[],
  contentType: string,
  outExt: string
): Promise<TranscodeResult> {
  const binary = ffmpegPath();
  if (!binary) return { status: "unavailable" };

  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(join(tmpdir(), "transcode-"));
    const inputPath = join(workDir, `input.${ext}`);
    const outputPath = join(workDir, outputName);
    await writeFile(inputPath, input);

    const run = await runFfmpeg(binary, args(inputPath, outputPath));
    if (run.failure) return { status: "error", reason: run.failure };

    const data = await readFile(outputPath);
    if (data.length === 0) return { status: "error", reason: "ffmpeg produced an empty file" };

    return { status: "ok", data, contentType, ext: outExt, durationSecs: durationFromFfmpegLog(run.stderr) };
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  } finally {
    // Whatever happened, a 200MB temp file must not be left behind.
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Resolves with a failure reason on failure, null on success, plus the log tail. */
function runFfmpeg(binary: string, args: string[]): Promise<{ failure: string | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });

    // ffmpeg writes everything to stderr, including progress. Only the
    // tail is kept — enough to diagnose a failure and read the final
    // progress line, not enough for a chatty encode to exhaust memory.
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ failure: `ffmpeg timed out after ${TIMEOUT_MS / 1000}s`, stderr });
    }, TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ failure: `could not run ffmpeg: ${error.message}`, stderr });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ failure: null, stderr });
      else
        resolve({
          failure: `ffmpeg exited with code ${code}: ${stderr.trim().split("\n").slice(-3).join(" ")}`,
          stderr,
        });
    });
  });
}
