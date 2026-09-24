import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { restartOnDeploy } from "@/lib/restartOnDeploy";

const dirs: string[] = [];
const stops: (() => void)[] = [];

function setup(withFile: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "restart-"));
  dirs.push(dir);
  // A subfolder, as on the server: tmp/ may not exist before the first deploy.
  const file = join(dir, "tmp", "restart.txt");
  if (withFile) {
    mkdirSync(join(dir, "tmp"));
    writeFileSync(file, "");
  }
  const exit = vi.fn();
  const log = vi.fn();
  stops.push(restartOnDeploy({ file, intervalMs: 20, exit, log }));
  return { file, exit, log };
}

/** Moves the file's modification time on, as `touch` does. */
function touch(file: string, secondsLater: number) {
  writeFileSync(file, "", { flag: "a" });
  const t = new Date(Date.now() + secondsLater * 1000);
  utimesSync(file, t, t);
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("restartOnDeploy", () => {
  test("exits when the deploy touches the file", async () => {
    const { file, exit, log } = setup(true);
    touch(file, 5);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 3000 });
    expect(log.mock.calls[0]![0]).toMatch(/new version/);
  });

  test("creates a missing file, and folder, at startup, then exits when the deploy touches it", async () => {
    // The first deploy to a fresh server: no tmp/ and no restart.txt yet.
    // Noticing a missing file appear is unreliable on Linux, so the file
    // is made to exist before the deploy ever touches it.
    const { file, exit } = setup(false);
    expect(existsSync(file)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(exit).not.toHaveBeenCalled();
    touch(file, 5);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 3000 });
  });

  test("does not exit for the file it started with", async () => {
    // The new process starts with the file the deploy just touched; taking
    // that as a request would restart it forever.
    const { exit } = setup(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(exit).not.toHaveBeenCalled();
  });

  test("exits once, however many times the file changes", async () => {
    const { file, exit } = setup(true);
    touch(file, 5);
    await new Promise((resolve) => setTimeout(resolve, 100));
    touch(file, 10);
    await vi.waitFor(() => expect(exit).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
