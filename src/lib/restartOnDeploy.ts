import { mkdirSync, statSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Restarts the server when a deploy says so, by exiting.
 *
 * The deploy (.github/workflows/ci.yml) copies the new build into place
 * and then touches tmp/restart.txt. Under Passenger (cPanel) that file is
 * the restart signal already. Under Enhance the app is a persistent
 * process in Automatic mode, which the panel starts again whenever it
 * exits; the deploy stops it with pkill from its SSH session, but on
 * Enhance a process listing from that session did not show the running
 * `node server.js` at all, so the pkill may find nothing and leave the old
 * version serving. What the SSH session and the app certainly share is
 * the site's files.
 *
 * So the running app watches the file itself, and exits when it changes.
 * Polling (watchFile) rather than inotify (watch), because inotify does
 * not see changes made from another container on the same volume.
 *
 * The file's time at startup is remembered and ignored: the new process
 * starts with the file the deploy just touched, and must not take that as
 * a request to restart again.
 *
 * If the file does not exist yet, it is created here, at startup. Polling
 * a missing file and noticing when it appears is where platforms differ:
 * on Linux it went unreported within the test's window while Windows
 * reported it at once. A file that always exists turns every deploy into
 * a plain change of modification time, which behaves the same everywhere,
 * and the very first deploy to a fresh server is exactly the case where
 * the file would otherwise be missing.
 */
export function restartOnDeploy({
  file = join(process.cwd(), "tmp", "restart.txt"),
  intervalMs = 2000,
  exit = (code: number) => process.exit(code),
  log = (message: string) => console.log(message),
}: {
  file?: string;
  intervalMs?: number;
  exit?: (code: number) => void;
  log?: (message: string) => void;
} = {}): () => void {
  const mtimeAt = (): number => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  };
  if (mtimeAt() === 0) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "", { flag: "a" });
    } catch {
      // A read-only disk: watch anyway, and the host's own restart still works.
    }
  }
  const startedWith = mtimeAt();
  let exiting = false;

  const onChange = (current: { mtimeMs: number }) => {
    if (exiting) return;
    // 0 means the file does not exist (or was deleted): not a request.
    if (current.mtimeMs === 0 || current.mtimeMs === startedWith) return;
    exiting = true;
    log("[deploy] tmp/restart.txt changed: a new version is in place. Exiting so the host starts it.");
    // A second's grace for requests already in flight.
    setTimeout(() => exit(0), 1000);
  };

  // persistent: false, so the watcher alone never keeps a process alive.
  watchFile(file, { interval: intervalMs, persistent: false }, onChange);
  return () => unwatchFile(file, onChange);
}
