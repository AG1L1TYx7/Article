/**
 * Parsing the HTTP Range header, for serving video.
 *
 * Not an optimisation. A browser asks for `Range: bytes=0-` the moment it
 * meets a `<video>` element, and Safari refuses to play at all unless the
 * server answers 206 with `Accept-Ranges: bytes`. Without range support,
 * seeking is impossible everywhere and playback is impossible on Apple
 * devices.
 *
 * Pure, so the awkward cases — a suffix range, an end past the file, a
 * malformed header — can be tested without a server.
 */

export type RangeResult =
  /** No Range header, or one this server does not honour: send the lot. */
  | { kind: "full" }
  /** A satisfiable range, inclusive of both ends as HTTP defines it. */
  | { kind: "partial"; start: number; end: number }
  /** Syntactically valid but outside the file: the spec requires a 416. */
  | { kind: "unsatisfiable" };

export function parseRange(header: string | null, size: number): RangeResult {
  if (!header) return { kind: "full" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Multi-range requests ("bytes=0-99,200-299") would need a multipart
  // response. Answering with the whole file is explicitly allowed and is
  // what every real player copes with.
  if (!match) return { kind: "full" };

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return { kind: "full" };

  // An empty file cannot satisfy any range.
  if (size === 0) return { kind: "unsatisfiable" };

  let start: number;
  let end: number;

  if (rawStart === "") {
    // "bytes=-500" means the last 500 bytes, not "up to byte 500".
    const suffix = Number(rawEnd);
    if (suffix === 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    // An end past the last byte is clamped rather than rejected: players
    // routinely ask for more than exists.
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: "full" };
  if (start >= size || start > end) return { kind: "unsatisfiable" };

  return { kind: "partial", start, end };
}

/** The value for a 206's Content-Range header. */
export function contentRange(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`;
}
