import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

/**
 * "Delete my account" — the right to erasure, GDPR Art. 17 / CCPA §1798.105.
 *
 * The User row is kept and anonymised rather than deleted. Comments,
 * reactions and audit entries point at it by foreign key; dropping the
 * row would either cascade through other people's reply threads or
 * orphan the security log. So every personal field is blanked, the
 * account is barred from ever signing in again, and what remains is a
 * number that ties a few rows together and identifies nobody. That is
 * what erasure means in practice — the data that makes it *this
 * person's* is gone.
 *
 * What goes, immediately:
 *   name, email, handle, password, MFA secret, last-login IP, avatar,
 *   sessions, push subscriptions, bookmarks, follows, likes, reports made, notifications,
 *   and every comment (tombstoned where a reply from someone else needs
 *   it to stay in the tree; fully deleted otherwise — the same rule the
 *   reader's own "delete comment" uses).
 *
 * What stays:
 *   audit-log rows (without the name or email they used to join to),
 *   until the retention purge removes them (lib/retention.ts);
 *   published articles, if the account wrote any — journalism is kept
 *   under the publisher's legitimate interest, so staff with articles
 *   are refused here and must ask an admin to reassign first.
 */
export async function anonymiseAccount(
  userId: string,
  by: { actorId: string; reason: "self" | "admin" }
): Promise<{ ok: boolean; error?: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, anonymisedAt: true, _count: { select: { articles: true } } },
  });
  if (!user) return { ok: false, error: "That account no longer exists." };
  if (user.anonymisedAt) return { ok: true };
  if (user._count.articles > 0) {
    return {
      ok: false,
      error:
        "This account has written articles. An admin needs to reassign them to another writer first — then the account can be deleted.",
    };
  }

  const now = new Date();
  const stub = `deleted-${user.id.slice(-10)}`;

  await db.$transaction(async (tx) => {
    // Comments: keep only those that hold up someone else's reply, and
    // strip them to a tombstone. Everything else goes.
    const comments = await tx.comment.findMany({
      where: { userId },
      select: { id: true, _count: { select: { replies: true } } },
    });
    const withReplies = comments.filter((c) => c._count.replies > 0).map((c) => c.id);
    const without = comments.filter((c) => c._count.replies === 0).map((c) => c.id);
    if (without.length) await tx.comment.deleteMany({ where: { id: { in: without } } });
    if (withReplies.length) {
      await tx.comment.updateMany({
        where: { id: { in: withReplies } },
        data: { body: "", status: "DELETED" },
      });
    }

    await tx.reaction.deleteMany({ where: { userId } });
    await tx.bookmark.deleteMany({ where: { userId } });
    await tx.follow.deleteMany({ where: { followerId: userId } });
    await tx.report.deleteMany({ where: { reporterId: userId } });
    await tx.notification.deleteMany({ where: { OR: [{ userId }, { actorId: userId }] } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });

    await tx.user.update({
      where: { id: userId },
      data: {
        name: "Deleted user",
        firstName: null,
        lastName: null,
        preferredName: null,
        bio: null,
        email: `${stub}@anonymised.invalid`,
        handle: stub,
        passwordHash: null,
        avatarUrl: null,
        mfaSecret: null,
        mfaEnabled: false,
        mfaRecoveryCodes: null,
        phoneEncrypted: null,
        phoneHash: null,
        phoneVerifiedAt: null,
        phoneCodeHash: null,
        phoneCodeExpires: null,
        pendingEmail: null,
        lastLoginIp: null,
        lastLoginAt: null,
        emailVerifiedAt: null,
        termsAcceptedAt: null,
        role: "READER",
        status: "BANNED",
        anonymisedAt: now,
        // Every outstanding session token stops validating.
        sessionVersion: { increment: 1 },
      },
    });
  });

  await recordAudit({
    actorId: by.actorId,
    action: by.reason === "self" ? "user.delete.self" : "user.delete.admin",
    targetType: "User",
    targetId: userId,
  });

  return { ok: true };
}
