"use server";

import { db } from "@/lib/db";
import { requireUser, guardAction } from "@/lib/auth/rbac";
import { revalidatePath } from "next/cache";

export interface NotificationActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Marks everything currently unread as read.
 *
 * Deliberately a button rather than something that happens while the page
 * renders. A mutation during a GET gets run by link prefetching and by
 * anything that follows links on the reader's behalf, so the list would
 * mark itself read before the person had actually looked at it — the same
 * trap that burned one-time email verification tokens earlier in this
 * project.
 */
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  return guardAction(async () => {
    const session = await requireUser();

    await db.notification.updateMany({
      // Scoped to the caller: there is no path here that touches anyone
      // else's notifications.
      where: { userId: session.user.id, readAt: null },
      data: { readAt: new Date() },
    });

    revalidatePath("/notifications");
    return { ok: true };
  });
}
