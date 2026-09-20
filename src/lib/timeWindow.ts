/**
 * Time windows for reporting.
 *
 * Reading the clock inside a component body is an eslint error
 * (react-hooks/purity) — it applies to server components too, since the
 * rule cannot tell them apart. Naming the window here keeps the clock out
 * of the render path and makes the boundary testable, the same reason
 * isCommentEditable lives in lib/commentPolicy.ts.
 */
export function daysAgo(days: number, now: number = Date.now()): Date {
  return new Date(now - days * 24 * 60 * 60 * 1000);
}
