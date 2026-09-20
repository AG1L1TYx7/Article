import { describe, expect, test } from "vitest";
import { contentRange, parseRange } from "@/lib/httpRange";

const SIZE = 1000;

describe("parseRange", () => {
  test("no header means send the whole file", () => {
    expect(parseRange(null, SIZE)).toEqual({ kind: "full" });
  });

  test("the request a video element actually makes", () => {
    // "bytes=0-" is what a browser sends the moment it meets <video>.
    expect(parseRange("bytes=0-", SIZE)).toEqual({ kind: "partial", start: 0, end: 999 });
  });

  test("an explicit range is inclusive of both ends", () => {
    // HTTP ranges include the final byte, so 0-99 is 100 bytes.
    expect(parseRange("bytes=0-99", SIZE)).toEqual({ kind: "partial", start: 0, end: 99 });
  });

  test("a suffix range means the last N bytes", () => {
    // "bytes=-500" is the last 500 bytes, not the first 500 — the single
    // easiest part of this header to get backwards.
    expect(parseRange("bytes=-500", SIZE)).toEqual({ kind: "partial", start: 500, end: 999 });
  });

  test("a suffix longer than the file starts at zero", () => {
    expect(parseRange("bytes=-5000", SIZE)).toEqual({ kind: "partial", start: 0, end: 999 });
  });

  test("an end past the last byte is clamped, not rejected", () => {
    // Players routinely ask for more than exists.
    expect(parseRange("bytes=900-99999", SIZE)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  test("a start past the end of the file is unsatisfiable", () => {
    expect(parseRange("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=5000-6000", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  test("a backwards range is unsatisfiable", () => {
    expect(parseRange("bytes=500-100", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  test("no range of an empty file can be satisfied", () => {
    expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });

  test("a zero-length suffix is unsatisfiable", () => {
    expect(parseRange("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  test("malformed headers fall back to the whole file rather than erroring", () => {
    for (const header of ["bytes=abc", "items=0-99", "bytes=", "nonsense", "bytes=1-2-3"]) {
      expect(parseRange(header, SIZE), header).toEqual({ kind: "full" });
    }
  });

  test("a multi-range request gets the whole file", () => {
    // Answering multi-range needs a multipart body; serving everything is
    // explicitly allowed and every real player copes.
    expect(parseRange("bytes=0-99,200-299", SIZE)).toEqual({ kind: "full" });
  });

  test("surrounding whitespace is tolerated", () => {
    expect(parseRange("  bytes=0-99  ", SIZE)).toEqual({ kind: "partial", start: 0, end: 99 });
  });
});

describe("contentRange", () => {
  test("formats the header the way the spec requires", () => {
    expect(contentRange(0, 99, 1000)).toBe("bytes 0-99/1000");
    expect(contentRange(500, 999, 1000)).toBe("bytes 500-999/1000");
  });
});
