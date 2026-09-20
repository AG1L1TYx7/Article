import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { notifyBreakingNews } from "@/lib/notifications";

/**
 * Publishes articles whose scheduled time has arrived.
 *
 * There is no always-on scheduler in this deployment — cPanel has no
 * worker, and a cron entry is one more thing to forget. So the check
 * rides on ordinary traffic instead: the public layout calls this after
 * each response, and it runs at most once a minute per process. A story
 * scheduled for 06:00 goes live on the first visit after 06:00, which for
 * a news site with any readers at all is 06:00.
 *
 * Deployments with a scheduler can call it from cron as well; it is
 * idempotent and cheap (one indexed query when nothing is due).
 */
const MIN_INTERVAL_MS = 60_000;
let lastRun = 0;
let running: Promise<number> | null = null;

export async function publishDueArticles(now: Date = new Date()): Promise<number> {
  if (running) return running;
  if (now.getTime() - lastRun < MIN_INTERVAL_MS) return 0;
  lastRun = now.getTime();

  running = (async () => {
    const due = await db.article.findMany({
      where: { status: "SCHEDULED", scheduledFor: { lte: now } },
      select: { id: true, slug: true, scheduledFor: true, publishedAt: true, isBreaking: true },
    });
    for (const article of due) {
      await db.article.update({
        where: { id: article.id },
        data: {
          status: "PUBLISHED",
          // The time it was meant to go live, not the moment someone
          // happened to load the front page.
          publishedAt: article.publishedAt ?? article.scheduledFor ?? now,
          scheduledFor: null,
        },
      });
      if (article.isBreaking) await notifyBreakingNews(article.id);
      revalidatePath(`/article/${article.slug}`);
    }
    if (due.length > 0) {
      revalidatePath("/");
      revalidatePath("/feed.xml");
      revalidatePath("/sitemap.xml");
      revalidatePath("/dashboard/articles");
    }
    return due.length;
  })().finally(() => {
    running = null;
  });

  return running;
}
