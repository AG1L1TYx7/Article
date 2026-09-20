import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { isBlockedAddress } from "./ssrf";

/**
 * Fetching a URL an author typed, without becoming an SSRF proxy.
 *
 * Uses node:http directly rather than fetch() for one reason that matters:
 * the `lookup` option lets this code supply the address the socket
 * actually connects to. Validating with a separate dns.lookup() call and
 * then handing the *hostname* to fetch leaves a DNS rebinding window —
 * the attacker's resolver answers with a public IP for the check and
 * 127.0.0.1 for the connection a moment later. Here the address that
 * passes the check is the address that gets dialled.
 *
 * Every redirect hop is re-checked the same way, because the first hop
 * being safe says nothing about where it points.
 */

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5_000;
/** Enough for any sane <head>; a preview never needs more. */
const MAX_BYTES = 256 * 1024;

export class UnsafeUrlError extends Error {}

/** What the caller is allowed to know. See the note on `fetchHtml`. */
export type SafeFetchFailure = "unreachable" | "not-html" | "too-large" | "blocked";

export interface SafeFetchResult {
  html: string;
  /** The URL the content actually came from, after any redirects. */
  finalUrl: string;
}

function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a web address.");
  }

  // http and https only. file:, gopher:, ftp: and friends are all ways to
  // reach things this server should not be reaching on request.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http:// and https:// links can be previewed.");
  }
  // Credentials in the URL would be sent to whatever it resolves to.
  if (url.username || url.password) {
    throw new UnsafeUrlError("Links with embedded credentials can't be previewed.");
  }

  // A literal IP in the URL has to be checked here, because Node skips the
  // `lookup` hook entirely when the host is already an address — there is
  // nothing to resolve, so the socket connects straight to it. Without
  // this, http://127.0.0.1:6379/ sailed past the guarded lookup below.
  // (Found by probing the fetcher against real local ports; the unit
  // tests on isBlockedAddress could never have caught it.)
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) !== 0 && isBlockedAddress(literal)) {
    throw new UnsafeUrlError("That address can't be previewed.");
  }

  return url;
}

/**
 * A DNS lookup that refuses to resolve to anywhere private.
 *
 * Node calls this for the connection itself, so whatever it returns is
 * what gets dialled — there is no gap between checking and connecting.
 */
const guardedLookup: typeof dnsLookup = ((
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void
) => {
  const cb = typeof options === "function" ? (options as typeof callback) : callback;

  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err);

    // Every answer must be public. A host that resolves to both a public
    // and a private address is rejected outright rather than filtered: if
    // it has any reason to point inside, previewing it is not worth it.
    for (const entry of addresses) {
      if (isBlockedAddress(entry.address)) {
        return cb(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }));
      }
    }

    const first = addresses[0];
    if (!first) return cb(Object.assign(new Error("no address"), { code: "ENOTFOUND" }));
    cb(null, first.address, first.family);
  });
}) as typeof dnsLookup;

function once(url: URL): Promise<{ response: IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          // Honest about what this is. Sites that would rather not be
          // previewed can then block it.
          "user-agent": "TheDispatchLinkPreview/1.0 (+link preview fetcher)",
          accept: "text/html,application/xhtml+xml",
          // Compressed responses would have to be inflated before the byte
          // cap could mean anything — a small gzip stream can expand to
          // gigabytes. Asking for identity keeps the cap honest.
          "accept-encoding": "identity",
        },
      },
      (response) => resolve({ response })
    );

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function readCapped(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    response.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        // Stop pulling bytes rather than reading a hostile endless
        // response to the end.
        response.destroy();
        resolve(Buffer.concat(chunks).toString("utf8"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", reject);
  });
}

/**
 * Fetches a URL's HTML, following a few redirects, checking every hop.
 *
 * Failures are reported as one of a handful of coarse reasons on purpose.
 * Passing the real error back to the author would turn this into a port
 * scanner: "connection refused" versus "timed out" versus "blocked
 * address" tells an attacker what is listening inside the network.
 */
export async function fetchHtml(raw: string): Promise<SafeFetchResult | SafeFetchFailure> {
  let url: URL;
  try {
    url = assertFetchableUrl(raw);
  } catch {
    return "blocked";
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: IncomingMessage;
    try {
      ({ response } = await once(url));
    } catch {
      return "unreachable";
    }

    const status = response.statusCode ?? 0;
    const location = response.headers.location;

    if (status >= 300 && status < 400 && location) {
      response.destroy();
      if (hop === MAX_REDIRECTS) return "unreachable";
      let next: URL;
      try {
        next = assertFetchableUrl(new URL(location, url).toString());
      } catch {
        return "blocked";
      }
      url = next;
      continue;
    }

    if (status < 200 || status >= 300) {
      response.destroy();
      return "unreachable";
    }

    const contentType = String(response.headers["content-type"] ?? "");
    if (!/^(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      response.destroy();
      return "not-html";
    }

    const declaredLength = Number(response.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      response.destroy();
      return "too-large";
    }

    try {
      const html = await readCapped(response);
      return { html, finalUrl: url.toString() };
    } catch {
      return "unreachable";
    }
  }

  return "unreachable";
}
