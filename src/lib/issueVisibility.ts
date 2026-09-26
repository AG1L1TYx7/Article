/**
 * What may leave the server about a reported issue, and to whom.
 *
 * This is the module that protects reporters. On a platform whose sectors
 * include corruption, the identity of the person who filed a report is the
 * most dangerous thing it holds — more dangerous than any password, because
 * a password can be changed and a name cannot be unlearned by the people it
 * was reported to.
 *
 * Two decisions are encoded here, and neither is a convention anybody has
 * to remember at a call site:
 *
 *   1. **Nothing unpublished is public.** A report under review is an
 *      unverified accusation about a named person or office. Publishing one
 *      early is a defamation risk to the platform and, in a small
 *      municipality, a danger to the reporter.
 *
 *   2. **An anonymous report never carries its reporter outward**, even
 *      though the account is kept. Verifiers need to be able to ask a
 *      follow-up question — a report nobody can go back to usually cannot
 *      be verified at all — so the link is stored. It simply never crosses
 *      this boundary.
 *
 * Deliberately pure, with no database import, so these rules can be tested
 * exhaustively without a database and so the test is about the rule rather
 * than about a query. The database half is lib/issues.ts. Same pairing as
 * searchQuery/search and analyticsClassify/analyticsCapture.
 *
 * Government bodies get exactly what the public gets. There is no wider
 * projection in this file and there should not be one added: the platform
 * must not become the channel that identifies critics to the people they
 * are criticising. Anything more should require a court order and a policy
 * you can point at.
 */

export type IssueStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "PUBLISHED"
  | "REJECTED"
  | "RESOLVED";

/** The statuses anybody may see without being staff or the reporter. */
export const PUBLIC_STATUSES: IssueStatus[] = ["PUBLISHED", "RESOLVED"];

export function isPublicStatus(status: IssueStatus): boolean {
  return PUBLIC_STATUSES.includes(status);
}

/** The shape this module is given — a row, or anything resembling one. */
export interface IssueRow {
  status: IssueStatus;
  anonymous: boolean;
  reporterId: string;
  reporter?: { id: string; name: string; handle: string; avatarUrl?: string | null } | null;
}

/** What a byline may say. */
export type PublicReporter =
  | { kind: "named"; id: string; name: string; handle: string; avatarUrl: string | null }
  | { kind: "anonymous" };

/**
 * The byline for a report, as the public may see it.
 *
 * Returns a marker rather than null for an anonymous report, because the
 * interface should say "reported anonymously" — silence reads as missing
 * data, and a reader deciding how much weight to give a report is entitled
 * to know the difference.
 */
export function publicReporter(issue: IssueRow): PublicReporter {
  if (issue.anonymous || !issue.reporter) return { kind: "anonymous" };
  return {
    kind: "named",
    id: issue.reporter.id,
    name: issue.reporter.name,
    handle: issue.reporter.handle,
    avatarUrl: issue.reporter.avatarUrl ?? null,
  };
}

/**
 * Who may see a report that is not published yet.
 *
 * The reporter, so they can follow their own report; and whoever may
 * verify, so the queue works. Nobody else — not other members, not other
 * reporters in the same district.
 */
export function canViewUnpublished(
  issue: IssueRow,
  viewer: { id: string; permissions: string[] } | null
): boolean {
  if (!viewer) return false;
  if (viewer.id === issue.reporterId) return true;
  return viewer.permissions.includes("issue.verify");
}

/**
 * The single question every read should ask.
 *
 * A published report is visible to everyone. An unpublished one is visible
 * to its reporter and to verifiers. There is no third case, and expressing
 * it as one function means a new page cannot accidentally invent one.
 */
export function canView(
  issue: IssueRow,
  viewer: { id: string; permissions: string[] } | null
): boolean {
  return isPublicStatus(issue.status) || canViewUnpublished(issue, viewer);
}

/**
 * Whether this viewer may be shown the reporter's identity.
 *
 * True for the reporter themselves — somebody must be able to see their own
 * report — and for verifiers, who need it to ask questions. False for
 * everybody else whenever the report is anonymous, regardless of status.
 *
 * Note what this is *not* conditioned on: whether the report is published.
 * An anonymous reporter stays anonymous to the public forever, and a named
 * one is named whether the report is live or not.
 */
export function canSeeReporter(
  issue: IssueRow,
  viewer: { id: string; permissions: string[] } | null
): boolean {
  if (!issue.anonymous) return true;
  if (!viewer) return false;
  if (viewer.id === issue.reporterId) return true;
  return viewer.permissions.includes("issue.verify");
}

/**
 * The transitions a report may make.
 *
 * Written down rather than left to whichever handler happens to run,
 * because the ones that must not happen are the interesting ones: a
 * rejected report must not quietly become published, and a published one
 * must not slide back into review as though it had never been public —
 * people have already seen it, and the honest move is to resolve or
 * correct it rather than to hide it.
 */
const TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["VERIFIED", "REJECTED", "SUBMITTED"],
  VERIFIED: ["PUBLISHED", "REJECTED", "UNDER_REVIEW"],
  PUBLISHED: ["RESOLVED"],
  REJECTED: ["UNDER_REVIEW"],
  RESOLVED: [],
};

export function canTransition(from: IssueStatus, to: IssueStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: IssueStatus): IssueStatus[] {
  return [...TRANSITIONS[from]];
}
