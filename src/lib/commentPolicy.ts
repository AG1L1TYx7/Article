/**
 * Comment rules shared by the server action and the UI.
 *
 * Lives outside the "use server" module on purpose: every export from a
 * file marked "use server" must be an async function, so a plain constant
 * there type-checks and lints cleanly but fails `next build`.
 */

/**
 * How long an author may rewrite their own comment.
 *
 * Not unlimited, deliberately: an unbounded edit window lets someone post
 * something innocuous, collect approval, likes and replies, then swap in
 * abuse or spam under all of that social proof. Fifteen minutes covers
 * typos and second thoughts, which is what editing is actually for.
 */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Whether an author may still rewrite a comment posted at `createdAt`.
 *
 * A function rather than an inline comparison so the action and the render
 * path can't drift apart, and so the rule itself is unit-testable. It also
 * keeps the clock out of component bodies, where React's purity rule
 * rightly objects to `Date.now()`.
 */
export function isCommentEditable(createdAt: Date, now: number = Date.now()): boolean {
  return now - createdAt.getTime() < COMMENT_EDIT_WINDOW_MS;
}
