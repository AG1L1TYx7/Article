/**
 * What a push notification says. Pure functions, so the wording and the
 * size limits can be tested without a browser or a push service.
 *
 * Push services cap a payload at about 4KB, and phones show roughly one
 * line of title and two of body before truncating for you — so the text
 * is cut here, on purpose, at a length that reads as a headline rather
 * than as an accident.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Path (not absolute): the service worker resolves it against its own origin. */
  url: string;
  /** Collapses repeat notifications about the same thing into one. */
  tag: string;
}

const TITLE_MAX = 80;
const BODY_MAX = 160;

export function truncate(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  // Cut at a word boundary where there is one close enough, so the last
  // word is not sliced in half.
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + "…";
}

export function breakingNewsPayload(article: { slug: string; title: string; dek: string | null }): PushPayload {
  return {
    title: truncate(`Breaking: ${article.title}`, TITLE_MAX),
    body: truncate(article.dek ?? "Tap to read the story.", BODY_MAX),
    url: `/article/${article.slug}`,
    tag: `breaking-${article.slug}`,
  };
}

/**
 * A verified report, to the district it concerns.
 *
 * The district is named in the title rather than the body because a
 * notification is often read as one line on a lock screen, and "Rautahat"
 * is what tells somebody in Rautahat that this is about them.
 *
 * The reporter is never named here, whether or not the report is
 * anonymous. A push notification is the least controllable surface the
 * platform has — it lands on a lock screen anybody nearby can read.
 */
export function issueInDistrictPayload(issue: {
  slug: string;
  title: string;
  districtName: string;
}): PushPayload {
  return {
    title: truncate(`${issue.districtName}: a verified report`, TITLE_MAX),
    body: truncate(issue.title, BODY_MAX),
    url: `/issues/${issue.slug}`,
    tag: `issue-${issue.slug}`,
  };
}

/** Something happened to a report this person filed. */
export function yourIssueUpdatedPayload(issue: {
  slug: string;
  title: string;
  status: string;
}): PushPayload {
  const what =
    issue.status === "PUBLISHED"
      ? "Your report has been published"
      : issue.status === "REJECTED"
        ? "Your report could not be verified"
        : issue.status === "RESOLVED"
          ? "Your report was marked resolved"
          : "Your report has been updated";
  return {
    title: truncate(what, TITLE_MAX),
    body: truncate(issue.title, BODY_MAX),
    url: `/issues/${issue.slug}`,
    tag: `issue-own-${issue.slug}`,
  };
}

export function commentReplyPayload(input: {
  actorName: string;
  articleSlug: string;
  articleTitle: string;
  commentId: string;
  body: string;
}): PushPayload {
  return {
    title: truncate(`${input.actorName} replied to your comment`, TITLE_MAX),
    body: truncate(input.body || input.articleTitle, BODY_MAX),
    url: `/article/${input.articleSlug}#comment-${input.commentId}`,
    tag: `reply-${input.commentId}`,
  };
}

export function commentApprovedPayload(input: {
  articleSlug: string;
  articleTitle: string;
  commentId: string;
}): PushPayload {
  return {
    title: "Your comment is now public",
    body: truncate(`on “${input.articleTitle}”`, BODY_MAX),
    url: `/article/${input.articleSlug}#comment-${input.commentId}`,
    tag: `approved-${input.commentId}`,
  };
}

/** The bytes actually handed to the push service. */
export function serialisePayload(payload: PushPayload): string {
  return JSON.stringify(payload);
}
