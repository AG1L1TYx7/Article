import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Re-encoding uploaded video with ffmpeg.
 *
 * The counterpart to what sharp does for images. An uploaded video is
 * whatever container and codec the author's phone produced — a .mov of
 * HEVC plays in Safari and nowhere else — and it carries metadata,
 * including the location it was filmed. Transcoding to H.264/AAC in MP4
 * normalises playback and drops everything not explicitly copied.
 *
 * Configured with FFMPEG_PATH. Without it this reports "unavailable" and
 * the caller stores the original, which is the behaviour this project had
 * before — the same dual-path shape as email, storage and scanning.
 *
 * Not a substitute for malware scanning. ffmpeg is a large C codebase
 * parsing hostile input; it reduces what a file can be, it does not make
 * a file safe. See lib/scan.ts.
 */

/** Generous, but bounded: a hung ffmpeg must not hold a request forever. */
const TIMEOUT_MS = 10 * 60 * 1000;

export type TranscodeResult =
  | { status: "ok"; data: Buffer; contentType: string; ext: string }
  /** Not configured. The caller keeps the original. */
  | { status: "unavailable" }
  | { status: "error"; reason: string };

export function isTranscodingConfigured(): boolean {
  return !!process.env.FFMPEG_PATH;
}

/**
 * The arguments ffmpeg is invoked with.
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
 * Transcodes a video. Never throws — every failure is a returned status.
 *
 * Works through temporary files rather than pipes: ffmpeg cannot write MP4
 * to a non-seekable output, because +faststart rewrites the header after
 * the body is complete.
 */
export async function transcodeVideo(input: Buffer, ext: string): Promise<TranscodeResult> {
  if (!isTranscodingConfigured()) return { status: "unavailable" };

  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(join(tmpdir(), "transcode-"));
    const inputPath = join(workDir, `input.${ext}`);
    const outputPath = join(workDir, "output.mp4");
    await writeFile(inputPath, input);

    const failure = await runFfmpeg(ffmpegArgs(inputPath, outputPath));
    if (failure) return { status: "error", reason: failure };

    const data = await readFile(outputPath);
    if (data.length === 0) return { status: "error", reason: "ffmpeg produced an empty file" };

    return { status: "ok", data, contentType: "video/mp4", ext: "mp4" };
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  } finally {
    // Whatever happened, a 200MB temp file must not be left behind.
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Resolves to null on success, or a reason string on failure. */
function runFfmpeg(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(process.env.FFMPEG_PATH!, args, { stdio: ["ignore", "ignore", "pipe"] });

    // ffmpeg writes everything to stderr, including progress. Only the
    // tail is kept — enough to diagnose a failure, not enough for a
    // chatty encode to exhaust memory.
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(`ffmpeg timed out after ${TIMEOUT_MS / 1000}s`);
    }, TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(`could not run ffmpeg: ${error.message}`);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(null);
      else resolve(`ffmpeg exited with code ${code}: ${stderr.trim().split("\n").slice(-3).join(" ")}`);
    });
  });
}
