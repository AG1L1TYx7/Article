import { fetchHtml, type SafeFetchFailure } from "./fetch";
import { parseLinkMetadata, type LinkMetadata } from "./parse";

export { isBlockedAddress } from "./ssrf";
export type { LinkMetadata } from "./parse";

export interface LinkPreview extends LinkMetadata {
  /** Where the content was actually read from, after redirects. */
  finalUrl: string;
}

/**
 * Fetches a URL and reads its title, description and site name.
 *
 * Returns null when the page could not be fetched or wasn't HTML. That is
 * not an error worth surfacing in detail: the link is still attached, it
 * just shows as a bare URL. Distinguishing "connection refused" from
 * "timed out" for the author would turn this into a port scanner.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const result: { html: string; finalUrl: string } | SafeFetchFailure = await fetchHtml(url);
  if (typeof result === "string") return null;

  return { ...parseLinkMetadata(result.html), finalUrl: result.finalUrl };
}
