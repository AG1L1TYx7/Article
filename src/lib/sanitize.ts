import DOMPurify from "isomorphic-dompurify";

// Strict allowlist for article body HTML. Applied on save AND on render
// (defense in depth — see security blueprint) so a bad row already in the
// database can never execute script in a reader's browser even if the
// save-time check were ever bypassed.
const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h2", "h3", "h4",
  "strong", "em", "s", "u",
  "ul", "ol", "li",
  "blockquote",
  "a",
  "img",
  "video", "audio", "source",
  "figure", "figcaption",
];
const ALLOWED_ATTR = [
  "href", "target", "rel",
  "src", "alt", "title", "width", "height",
  "controls", "poster", "preload", "playsinline", "type",
];

export function sanitizeArticleHtml(rawHtml: string): string {
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // data-media-id and data-kind on a figure tie it to its Media row, so
    // the credits, the player and the publish gate know which file it is.
    // DOMPurify permits data-* attributes by default; stated here so the
    // dependence is visible, and every other attribute stays on the list.
    ALLOW_DATA_ATTR: true,
    // Belt and suspenders on top of the tag/attribute allowlist above: even
    // an allowed tag can't carry an inline event handler. javascript:/data:
    // URIs are already blocked by DOMPurify's own (well-tested) default URI
    // sanitizer — deliberately not overriding that with a custom regex here.
    // `autoplay` is refused too: a story must never start making noise.
    FORBID_ATTR: ["style", "onerror", "onload", "onclick", "onplay", "autoplay", "loop", "srcdoc"],
  });
}
