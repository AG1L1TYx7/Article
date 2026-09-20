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
  "video",
  "figure", "figcaption",
];
const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "controls", "poster", "width", "height"];

export function sanitizeArticleHtml(rawHtml: string): string {
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Belt and suspenders on top of the tag/attribute allowlist above: even
    // an allowed tag can't carry an inline event handler. javascript:/data:
    // URIs are already blocked by DOMPurify's own (well-tested) default URI
    // sanitizer — deliberately not overriding that with a custom regex here.
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
  });
}
