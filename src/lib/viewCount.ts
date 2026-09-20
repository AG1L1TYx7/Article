import { after } from "next/server";
import { db } from "@/lib/db";

/**
 * Counts an article view, after the response has already gone out.
 *
 * `after()` schedules the write for once the page has been sent, so a
 * reader never waits on it. A view counter that makes the article slower
 * to load has cost more than it measures.
 *
 * Deliberately crude. This counts requests, not people: a refresh counts
 * twice, and a crawler counts as a reader. It is here to answer "which of
 * these is being read more than the others", which it does honestly, and
 * not "how many humans read this", which it cannot. Anything better needs
 * a real analytics pipeline rather than a column.
 */
export function countArticleView(articleId: string): void {
  after(async () => {
    try {
      await db.article.update({
        where: { id: articleId },
        data: { viewCount: { increment: 1 } },
      });
    } catch {
      // A missed count is not worth an error anywhere. The article was
      // already served successfully by the time this runs.
    }
  });
}
