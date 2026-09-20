import { after } from "next/server";
import { db } from "@/lib/db";
import { recordViewDimensions, type ViewContext } from "@/lib/analyticsCapture";

/**
 * Counts an article view, after the response has already gone out.
 *
 * `after()` schedules the write for once the page has been sent, so a
 * reader never waits on it. A view counter that makes the article slower
 * to load has cost more than it measures.
 *
 * Deliberately crude. This counts requests, not people: a refresh counts
 * twice, and a crawler counts as a reader (though it is classed as a
 * "bot" in the device dimension so it can be discounted). It is here to
 * answer "which of these is being read more than the others", which it
 * does honestly, and not "how many humans read this", which it cannot.
 *
 * Three writes: the running total on the article, a per-day row so the
 * analytics page can draw a line, and the per-day country / referrer /
 * device buckets. All raw SQL rather than `db.article.update`, on
 * purpose: Prisma's `@updatedAt` is applied by the client on every
 * update, so counting a view through it stamped `updatedAt` with the
 * time of the view. That made "Updated 3 hours ago" meaningless and
 * busted the sanitised-HTML cache (keyed on updatedAt) on every request.
 */
export function countArticleView(articleId: string, context?: ViewContext): void {
  after(async () => {
    try {
      await db.$executeRaw`UPDATE \`Article\` SET \`viewCount\` = \`viewCount\` + 1 WHERE \`id\` = ${articleId}`;
      await db.$executeRaw`INSERT INTO \`ArticleViewDaily\` (\`articleId\`, \`day\`, \`views\`) VALUES (${articleId}, UTC_DATE(), 1) ON DUPLICATE KEY UPDATE \`views\` = \`views\` + 1`;
      if (context) await recordViewDimensions(articleId, context);
    } catch {
      // A missed count is not worth an error anywhere. The article was
      // already served successfully by the time this runs.
    }
  });
}
