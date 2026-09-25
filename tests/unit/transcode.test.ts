import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegArgs, isTranscodingConfigured, transcodeVideo } from "@/lib/transcode";

/**
 * ffmpeg is not installed in this environment, so these tests point
 * FFMPEG_PATH at small Node scripts standing in for it — one that copies
 * its input to its output, one that fails, one that writes nothing.
 *
 * That genuinely exercises the parts most likely to break: argument
 * order, spawn and exit handling, what happens on a non-zero exit, and
 * whether the temporary working directory is removed on every path. What
 * it cannot verify is that real ffmpeg accepts these arguments or
 * produces playable output — treat the first real transcode as the true
 * test of that.
 *
 * The spawn-based tests do not run on Windows. Since a 2024 security fix,
 * Node refuses to spawn a .cmd or .bat file without a shell, and the
 * stand-in has to be one of those there — while adding shell: true to the
 * production code purely for tests would introduce an injection surface
 * for no benefit. They run in CI, which is Linux, and Linux is what this
 * is deployed on. The pure argument tests below run everywhere.
 */
const spawnable = process.platform !== "win32";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "faketools-"));
});

afterEach(async () => {
  delete process.env.FFMPEG_PATH;
  await rm(workDir, { recursive: true, force: true });
});

/**
 * Installs a stand-in for ffmpeg and points FFMPEG_PATH at it.
 *
 * FFMPEG_PATH has to name something spawnable, so the Node script is
 * wrapped in a one-line executable appropriate to the platform.
 */
async function useFakeFfmpeg(script: string): Promise<void> {
  const id = Math.random().toString(36).slice(2);
  const scriptPath = join(workDir, `fake-${id}.mjs`);
  await writeFile(scriptPath, script);

  const isWindows = process.platform === "win32";
  const wrapperPath = join(workDir, isWindows ? `fake-${id}.cmd` : `fake-${id}.sh`);
  await writeFile(
    wrapperPath,
    isWindows
      ? `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    { mode: 0o755 }
  );

  process.env.FFMPEG_PATH = wrapperPath;
}

/** Counts the working directories transcodeVideo leaves in the temp dir. */
async function countLeftoverDirs(): Promise<number> {
  const entries = await readdir(tmpdir());
  return entries.filter((name) => name.startsWith("transcode-")).length;
}

describe("ffmpegArgs", () => {
  test("encodes to a widely playable format", () => {
    const args = ffmpegArgs("/in.mov", "/out.mp4");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    // Without yuv420p, footage from some cameras encodes to a pixel
    // format Safari and most Android players refuse outright.
    expect(args).toContain("yuv420p");
  });

  test("strips source metadata", () => {
    // A phone records GPS coordinates into the file. A newsroom should
    // not republish where a video was filmed by accident.
    const args = ffmpegArgs("/in.mov", "/out.mp4");
    const index = args.indexOf("-map_metadata");
    expect(index).toBeGreaterThan(-1);
    expect(args[index + 1]).toBe("-1");
  });

  test("moves the index to the front so playback can start early", () => {
    const args = ffmpegArgs("/in.mov", "/out.mp4");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
  });

  test("never waits for input, and takes input before output", () => {
    const args = ffmpegArgs("/in.mov", "/out.mp4");
    // A prompt on a server is a hang.
    expect(args).toContain("-nostdin");
    expect(args.indexOf("/in.mov")).toBeLessThan(args.indexOf("/out.mp4"));
    expect(args[args.length - 1]).toBe("/out.mp4");
  });
});

describe("transcodeVideo without a working binary", () => {
  test("the bundled ffmpeg is found without FFMPEG_PATH, and garbage input is an error, not a crash", async () => {
    // ffmpeg-static downloads a real binary at npm install; with nothing
    // configured it is what runs. Feeding it a file that is not a video
    // must come back as a clean failure.
    expect(isTranscodingConfigured()).toBe(true);
    expect((await transcodeVideo(Buffer.from("x"), "mov")).status).toBe("error");
  });

  test("a missing binary is an error rather than a crash", async () => {
    process.env.FFMPEG_PATH = join(workDir, "does-not-exist");
    expect((await transcodeVideo(Buffer.from("x"), "mov")).status).toBe("error");
  });
});

describe.skipIf(!spawnable)("transcodeVideo (spawns a stand-in ffmpeg)", () => {
  test("a successful run returns the encoded bytes as MP4", async () => {
    await useFakeFfmpeg(
      `import fs from "node:fs";
       const args = process.argv.slice(2);
       const input = args[args.indexOf("-i") + 1];
       const output = args[args.length - 1];
       fs.writeFileSync(output, "ENCODED:" + fs.readFileSync(input).toString());`
    );

    const result = await transcodeVideo(Buffer.from("source bytes"), "mov");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // Proves the input reached ffmpeg and the output came back.
      expect(result.data.toString()).toBe("ENCODED:source bytes");
      expect(result.contentType).toBe("video/mp4");
      expect(result.ext).toBe("mp4");
    }
  });

  test("a non-zero exit is an error, never a silent pass", async () => {
    // The dangerous failure is returning "ok" for a file ffmpeg rejected.
    await useFakeFfmpeg(`process.stderr.write("Invalid data found\\n"); process.exit(1);`);

    const result = await transcodeVideo(Buffer.from("not a video"), "mov");
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toContain("code 1");
      // The tail of stderr is kept, because "it failed" is not diagnosable.
      expect(result.reason).toContain("Invalid data");
    }
  });

  test("an empty output file is an error", async () => {
    await useFakeFfmpeg(
      `import fs from "node:fs";
       fs.writeFileSync(process.argv[process.argv.length - 1], "");`
    );

    expect((await transcodeVideo(Buffer.from("x"), "mov")).status).toBe("error");
  });

  test("producing no output at all is an error", async () => {
    // Exits cleanly but writes nothing — reading the output must fail
    // rather than throwing out of the module.
    await useFakeFfmpeg(`process.exit(0);`);

    expect((await transcodeVideo(Buffer.from("x"), "mov")).status).toBe("error");
  });

  test("the working directory is removed whether it succeeds or fails", async () => {
    // A 200MB temporary file left behind on every failed upload fills a
    // disk surprisingly quickly.
    const before = await countLeftoverDirs();

    await useFakeFfmpeg(
      `import fs from "node:fs";
       fs.writeFileSync(process.argv[process.argv.length - 1], "out");`
    );
    await transcodeVideo(Buffer.from("x"), "mov");

    await useFakeFfmpeg(`process.exit(3);`);
    await transcodeVideo(Buffer.from("x"), "mov");

    expect(await countLeftoverDirs()).toBe(before);
  });
});
