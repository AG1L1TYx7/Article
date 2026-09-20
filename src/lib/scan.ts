import { connect, type Socket } from "node:net";

/**
 * Malware scanning for uploads, via ClamAV's clamd daemon.
 *
 * Speaks INSTREAM over TCP rather than shelling out to `clamscan`: the
 * daemon keeps the ~250MB signature database loaded in memory, where the
 * command-line scanner reloads it on every invocation and takes tens of
 * seconds per file.
 *
 * Configured with CLAMAV_HOST. Without it scanning reports "unavailable",
 * and callers keep their existing conservative behaviour — the same
 * dual-path shape as email, storage and rate limiting elsewhere in this
 * project, so the app and its tests run before any of this is deployed.
 *
 * Protocol, from clamd(8): send `zINSTREAM\0`, then a sequence of chunks
 * each prefixed with its length as a 4-byte big-endian integer, then a
 * zero-length chunk to finish. The reply is one NUL-terminated line.
 */

const DEFAULT_PORT = 3310;
const CHUNK_SIZE = 64 * 1024;
/** Generous: a 200MB video over a loaded scanner is not instant. */
const TIMEOUT_MS = 120_000;

export type ScanResult =
  | { status: "clean" }
  | { status: "infected"; signature: string }
  /** Scanning is not configured. Not a failure — a deliberate absence. */
  | { status: "unavailable" }
  /** Configured but did not answer. Callers must treat this as unsafe. */
  | { status: "error"; reason: string };

export function isScanningConfigured(): boolean {
  return !!process.env.CLAMAV_HOST;
}

function openSocket(): Promise<Socket> {
  const host = process.env.CLAMAV_HOST!;
  const port = Number(process.env.CLAMAV_PORT ?? DEFAULT_PORT);

  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => resolve(socket));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("timed out connecting to clamd"));
    });
    socket.once("error", reject);
  });
}

/** Frames one chunk: a 4-byte big-endian length followed by the bytes. */
function frame(chunk: Buffer): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(chunk.length, 0);
  return Buffer.concat([header, chunk]);
}

/**
 * Parses clamd's reply.
 *
 * "stream: OK", "stream: Eicar-Test-Signature FOUND", or something ending
 * in ERROR. Anything unrecognised is an error rather than a pass —
 * guessing that an unknown reply means "clean" is how a scanner silently
 * stops scanning.
 */
export function parseScanReply(reply: string): ScanResult {
  const line = reply.replace(/\0+$/, "").trim();

  if (/\bOK$/.test(line)) return { status: "clean" };

  const found = /^(?:stream:\s*)?(.+?)\s+FOUND$/i.exec(line);
  if (found) return { status: "infected", signature: found[1] };

  if (/ERROR$/i.test(line)) return { status: "error", reason: line };

  return { status: "error", reason: `unrecognised reply: ${line || "(empty)"}` };
}

/**
 * Scans a buffer. Never throws — every failure is a returned status, so a
 * caller cannot accidentally treat a thrown error as a pass.
 */
export async function scanBuffer(data: Buffer): Promise<ScanResult> {
  if (!isScanningConfigured()) return { status: "unavailable" };

  let socket: Socket;
  try {
    socket = await openSocket();
  } catch (error) {
    return { status: "error", reason: `cannot reach clamd: ${(error as Error).message}` };
  }

  return new Promise<ScanResult>((resolve) => {
    let reply = "";
    let settled = false;

    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      // clamd terminates its reply with a NUL.
      if (reply.includes("\0")) finish(parseScanReply(reply));
    });
    socket.on("timeout", () => finish({ status: "error", reason: "clamd timed out" }));
    socket.on("error", (error) => finish({ status: "error", reason: error.message }));
    socket.on("close", () => {
      // A close with a reply already buffered is normal; a close without
      // one means the scan never completed.
      if (reply) finish(parseScanReply(reply));
      else finish({ status: "error", reason: "clamd closed the connection without replying" });
    });

    socket.write("zINSTREAM\0");
    for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
      socket.write(frame(data.subarray(offset, offset + CHUNK_SIZE)));
    }
    // Zero-length chunk: end of stream.
    socket.write(Buffer.from([0, 0, 0, 0]));
  });
}

/**
 * The single question a caller actually has: may this file be served?
 *
 * Fails closed. "Clean" is the only answer that permits it — an
 * unreachable or confused scanner leaves the upload quarantined rather
 * than letting it through, because a scanner that fails open is not a
 * scanner.
 */
export function isSafeToServe(result: ScanResult): boolean {
  return result.status === "clean";
}
