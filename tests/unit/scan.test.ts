import { afterEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:net";
import { isSafeToServe, isScanningConfigured, parseScanReply, scanBuffer } from "@/lib/scan";

/**
 * ClamAV is not installed in this environment, so these tests stand up a
 * fake clamd that speaks the real INSTREAM protocol. That is enough to
 * verify what actually matters here: that the client frames the stream
 * the way clamd expects, and — more importantly — that every way a
 * scanner can fail leaves the upload quarantined rather than served.
 *
 * What this cannot prove is that real clamd agrees with our framing. The
 * protocol is small and documented, but treat the first upload against a
 * real daemon as the true test.
 */

let server: Server | undefined;

/** Starts a fake clamd that captures what it receives and replies. */
async function fakeClamd(
  reply: string | null,
  options: { closeEarly?: boolean } = {}
): Promise<{ received: Buffer[] }> {
  const received: Buffer[] = [];

  server = createServer((socket) => {
    socket.on("data", (chunk) => {
      received.push(chunk);
      const combined = Buffer.concat(received);
      // The stream ends with a zero-length chunk: four zero bytes.
      const tail = combined.subarray(combined.length - 4);
      if (combined.length >= 4 && tail.equals(Buffer.from([0, 0, 0, 0]))) {
        if (options.closeEarly) socket.destroy();
        else if (reply !== null) socket.end(reply);
      }
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("no port");

  process.env.CLAMAV_HOST = "127.0.0.1";
  process.env.CLAMAV_PORT = String(address.port);

  return { received };
}

afterEach(async () => {
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe("parseScanReply", () => {
  test("recognises a clean result", () => {
    expect(parseScanReply("stream: OK\0")).toEqual({ status: "clean" });
  });

  test("recognises an infection and keeps the signature name", () => {
    expect(parseScanReply("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      status: "infected",
      signature: "Eicar-Test-Signature",
    });
  });

  test("treats clamd's own errors as errors", () => {
    expect(parseScanReply("INSTREAM size limit exceeded. ERROR\0").status).toBe("error");
  });

  test("an unrecognised reply is an error, never a pass", () => {
    // Guessing that something unknown means "clean" is how a scanner
    // silently stops scanning.
    expect(parseScanReply("what?\0").status).toBe("error");
    expect(parseScanReply("\0").status).toBe("error");
    expect(parseScanReply("").status).toBe("error");
  });
});

describe("scanBuffer against a fake clamd", () => {
  test("reports unavailable when scanning is not configured", async () => {
    expect(isScanningConfigured()).toBe(false);
    await expect(scanBuffer(Buffer.from("anything"))).resolves.toEqual({ status: "unavailable" });
  });

  test("sends the INSTREAM command, framed chunks, and a terminator", async () => {
    const { received } = await fakeClamd("stream: OK\0");
    const payload = Buffer.from("hello clamd");

    await scanBuffer(payload);

    const sent = Buffer.concat(received);
    expect(sent.subarray(0, 10).toString()).toBe("zINSTREAM\0");

    // After the command: a 4-byte big-endian length, then the bytes.
    const length = sent.readUInt32BE(10);
    expect(length).toBe(payload.length);
    expect(sent.subarray(14, 14 + payload.length).toString()).toBe("hello clamd");

    // And a zero-length chunk to close the stream.
    expect(sent.subarray(sent.length - 4)).toEqual(Buffer.from([0, 0, 0, 0]));
  });

  test("splits a large file into chunks and reassembles to the original", async () => {
    const { received } = await fakeClamd("stream: OK\0");
    // Larger than the 64KB chunk size, so framing is exercised more than once.
    const payload = Buffer.alloc(200_000, 0x41);

    await expect(scanBuffer(payload)).resolves.toEqual({ status: "clean" });

    const sent = Buffer.concat(received);
    let offset = "zINSTREAM\0".length;
    const chunks: Buffer[] = [];
    for (;;) {
      const length = sent.readUInt32BE(offset);
      offset += 4;
      if (length === 0) break;
      chunks.push(sent.subarray(offset, offset + length));
      offset += length;
    }
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  test("reports an infection", async () => {
    await fakeClamd("stream: Eicar-Test-Signature FOUND\0");
    await expect(scanBuffer(Buffer.from("x"))).resolves.toEqual({
      status: "infected",
      signature: "Eicar-Test-Signature",
    });
  });

  test("a daemon that hangs up without replying is an error", async () => {
    await fakeClamd(null, { closeEarly: true });
    const result = await scanBuffer(Buffer.from("x"));
    expect(result.status).toBe("error");
  });

  test("an unreachable daemon is an error, not a silent pass", async () => {
    process.env.CLAMAV_HOST = "127.0.0.1";
    // Nothing is listening here.
    process.env.CLAMAV_PORT = "1";
    const result = await scanBuffer(Buffer.from("x"));
    expect(result.status).toBe("error");
  });
});

describe("isSafeToServe fails closed", () => {
  test("only a clean result permits serving", () => {
    expect(isSafeToServe({ status: "clean" })).toBe(true);
  });

  test("every other outcome quarantines the file", () => {
    // A scanner that fails open is not a scanner. "unavailable" is
    // included deliberately: callers decide what to do when scanning is
    // switched off, and that decision must be explicit, not a default.
    expect(isSafeToServe({ status: "infected", signature: "X" })).toBe(false);
    expect(isSafeToServe({ status: "error", reason: "down" })).toBe(false);
    expect(isSafeToServe({ status: "unavailable" })).toBe(false);
  });
});
