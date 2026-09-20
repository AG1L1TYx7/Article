import { db } from "@/lib/db";
import { LEGAL } from "@/lib/legal";

/**
 * Everything the site holds about one person, as plain JSON — the right
 * of access (GDPR Art. 15) and portability (Art. 20), and the CCPA right
 * to know, served by a button rather than a support ticket.
 *
 * Complete by construction: every table with a userId is read here. When
 * a new one is added, add it here, or the export is quietly wrong.
 * Secrets are never included — the password hash and the MFA secret are
 * ours to protect, not theirs to carry around.
 */
export async function exportPersonalData(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      handle: true,
      email: true,
      emailVerifiedAt: true,
      role: true,
      status: true,
      mfaEnabled: true,
      termsAcceptedAt: true,
      createdAt: true,
      lastLoginAt: true,
      lastLoginIp: true,
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          status: true,
          createdAt: true,
          editedAt: true,
          article: { select: { title: true, slug: true } },
        },
      },
      reactions: {
        select: {
          createdAt: true,
          article: { select: { title: true, slug: true } },
          comment: { select: { id: true, article: { select: { slug: true } } } },
        },
      },
      bookmarks: { select: { createdAt: true, article: { select: { title: true, slug: true } } } },
      follows: {
        select: {
          createdAt: true,
          author: { select: { name: true, handle: true } },
          category: { select: { name: true, slug: true } },
        },
      },
      reports: { select: { reason: true, status: true, createdAt: true, commentId: true, articleId: true } },
      notifications: { select: { type: true, createdAt: true, readAt: true } },
      pushSubscriptions: { select: { endpoint: true, createdAt: true, lastUsedAt: true } },
      articles: { select: { title: true, slug: true, status: true, publishedAt: true } },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        select: { action: true, createdAt: true, ip: true },
      },
    },
  });
  if (!user) return null;

  return {
    exportedAt: new Date().toISOString(),
    site: LEGAL.siteName,
    controller: LEGAL.entity,
    policyVersion: LEGAL.policyVersion,
    account: {
      id: user.id,
      name: user.name,
      handle: user.handle,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      role: user.role,
      status: user.status,
      twoFactorEnabled: user.mfaEnabled,
      termsAcceptedAt: user.termsAcceptedAt,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
    },
    comments: user.comments,
    likes: user.reactions.map((r) => ({
      createdAt: r.createdAt,
      article: r.article ?? undefined,
      commentId: r.comment?.id,
    })),
    savedArticles: user.bookmarks,
    following: user.follows.map((f) => ({
      ...(f.author ?? {}),
      ...(f.category ? { section: f.category.name, sectionSlug: f.category.slug } : {}),
      since: f.createdAt,
    })),
    // The push service that issued each endpoint is visible in its host;
    // the rest of the URL is the opaque address of one browser.
    pushAlertDevices: user.pushSubscriptions.map((p) => ({
      pushService: new URL(p.endpoint).host,
      since: p.createdAt,
      lastAlertedAt: p.lastUsedAt,
    })),
    reportsMade: user.reports,
    notifications: user.notifications,
    articlesWritten: user.articles,
    securityLog: user.auditLogs,
  };
}
