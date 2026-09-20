"use server";

import { db } from "@/lib/db";
import { requireRole, requireVerifiedEmail, ForbiddenError, guardAction } from "@/lib/auth/rbac";
import { addArticleLinkSchema, articleInputSchema, type ArticleInput } from "@/lib/validation/article";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { extractSearchText } from "@/lib/searchText";
import { slugify } from "@/lib/slugify";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { linkPreviewLimiter } from "@/lib/rateLimit";
import { fetchLinkPreview } from "@/lib/linkPreview";
import { notifyBreakingNews } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import type { Article } from "@/generated/prisma/client";

export interface ArticleActionResult {
  ok: boolean;
  id?: string;
  slug?: string;
  error?: string;
}

// Moderators may write and publish their own articles; editing or
// unpublishing *someone else's* article is Admin-only — see the roles &
// permissions table in the plan. Admins can act on anything.
function assertCanEdit(role: string, userId: string, article: Pick<Article, "authorId">) {
  if (role !== "ADMIN" && article.authorId !== userId) {
    throw new ForbiddenError("You can only edit your own articles.");
  }
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "article";
  let candidate = root;
  let n = 2;
  // Small, bounded loop against a unique index — fine at article-authoring
  // volumes; revisit if this ever needs to handle bulk/import writes.
  for (;;) {
    const existing = await db.article.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${root}-${n++}`;
  }
}

/**
 * Checks that optional foreign keys actually exist before we hand them to
 * Prisma. Without this a bogus categoryId/coverImageId (easy to send —
 * these come straight off a client form) hits a foreign-key constraint
 * and surfaces as an unhandled 500 rather than a message the author can
 * act on.
 */
async function validateRelations(categoryId?: string, coverImageId?: string): Promise<string | null> {
  if (categoryId) {
    const category = await db.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) return "That category no longer exists.";
  }
  if (coverImageId) {
    const media = await db.media.findUnique({ where: { id: coverImageId }, select: { id: true } });
    if (!media) return "That cover image no longer exists.";
  }
  return null;
}

async function syncTags(articleId: string, tagSlugs: string[] | undefined) {
  await db.articleTag.deleteMany({ where: { articleId } });
  if (!tagSlugs?.length) return;

  const wanted = new Map<string, string>();
  for (const raw of tagSlugs) {
    const slug = slugify(raw);
    if (slug) wanted.set(slug, raw.trim().slice(0, 50));
  }
  if (wanted.size === 0) return;

  // Three queries regardless of how many tags, instead of two per tag.
  // createMany with skipDuplicates handles the "tag already exists" case
  // without needing to check first, and without failing the whole write
  // if two authors add the same new tag at the same moment.
  await db.tag.createMany({
    data: [...wanted].map(([slug, name]) => ({ slug, name })),
    skipDuplicates: true,
  });

  const tags = await db.tag.findMany({
    where: { slug: { in: [...wanted.keys()] } },
    select: { id: true },
  });

  await db.articleTag.createMany({
    data: tags.map((tag) => ({ articleId, tagId: tag.id })),
    skipDuplicates: true,
  });
}

/**
 * The alt text lives on the Media row, so the same image reused as a
 * cover elsewhere keeps its description. Only written when a cover is
 * set and the form sent a value; an absent field leaves it alone.
 */
async function applyCoverAlt(data: ArticleInput) {
  if (!data.coverImageId || data.coverAltText === undefined) return;
  await db.media.update({
    where: { id: data.coverImageId },
    data: { altText: data.coverAltText.trim() || null },
  });
}

/**
 * What saving does to a draft's schedule.
 *
 * A future time on a DRAFT or SCHEDULED article schedules it; no time on
 * a SCHEDULED article cancels the schedule and returns it to DRAFT. A
 * PUBLISHED or ARCHIVED article is never touched — its status is changed
 * by the publish/unpublish/archive actions, not by saving text.
 *
 * Scheduling is publishing with a delay, so it needs the same confirmed
 * email address that publishing does.
 */
function scheduleFields(
  data: ArticleInput,
  current: { status: string } | null,
  emailConfirmed: boolean
): { error?: string; data: { status?: "DRAFT" | "SCHEDULED"; scheduledFor?: Date | null } } {
  const status = current?.status ?? "DRAFT";
  if (status !== "DRAFT" && status !== "SCHEDULED") return { data: {} };
  if (data.scheduledFor) {
    if (!emailConfirmed) return { error: "Verify your email address to schedule publishing.", data: {} };
    return { data: { status: "SCHEDULED", scheduledFor: new Date(data.scheduledFor) } };
  }
  if (status === "SCHEDULED") return { data: { status: "DRAFT", scheduledFor: null } };
  return { data: {} };
}

export async function createArticle(input: ArticleInput): Promise<ArticleActionResult> {
  return guardAction(async () => {
    const session = await requireRole("MODERATOR");

    const parsed = articleInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const data = parsed.data;

    const relationError = await validateRelations(data.categoryId, data.coverImageId);
    if (relationError) return { ok: false, error: relationError };

    const slug = await uniqueSlug(data.slug || data.title);
    const bodyHtml = sanitizeArticleHtml(data.bodyHtml);

    const schedule = scheduleFields(data, null, session.user.emailConfirmed);
    if (schedule.error) return { ok: false, error: schedule.error };

    const article = await db.article.create({
      data: {
        title: data.title,
        dek: data.dek,
        slug,
        bodyJson: data.bodyJson as object,
        bodyHtml,
        // Derived at write time, not query time: authors save an article a
        // few times, readers search against it indefinitely.
        searchText: extractSearchText(bodyHtml),
        excerpt: data.excerpt,
        // `?? null`, not the raw value: the form always sends its whole
        // state, so an absent id means "none" — clearing the section or
        // removing the cover — and undefined would tell Prisma to leave
        // the old value in place.
        categoryId: data.categoryId ?? null,
        coverImageId: data.coverImageId ?? null,
        isBreaking: data.isBreaking ?? false,
        seoTitle: data.seoTitle?.trim() || null,
        seoDescription: data.seoDescription?.trim() || null,
        authorId: session.user.id,
        status: schedule.data.status ?? "DRAFT",
        scheduledFor: schedule.data.scheduledFor ?? null,
      },
    });

    await syncTags(article.id, data.tagSlugs);
    await applyCoverAlt(data);
    await recordAudit({
      actorId: session.user.id,
      action: "article.create",
      targetType: "Article",
      targetId: article.id,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/articles");
    return { ok: true, id: article.id, slug: article.slug };
  });
}

export async function updateArticle(articleId: string, input: ArticleInput): Promise<ArticleActionResult> {
  return guardAction(async () => {
    const session = await requireRole("MODERATOR");

    const article = await db.article.findUnique({ where: { id: articleId } });
    if (!article) return { ok: false, error: "Article not found." };
    assertCanEdit(session.user.role, session.user.id, article);

    const parsed = articleInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const data = parsed.data;

    const relationError = await validateRelations(data.categoryId, data.coverImageId);
    if (relationError) return { ok: false, error: relationError };

    const slug =
      data.slug && data.slug !== article.slug ? await uniqueSlug(data.slug, articleId) : article.slug;
    const bodyHtml = sanitizeArticleHtml(data.bodyHtml);

    const schedule = scheduleFields(data, article, session.user.emailConfirmed);
    if (schedule.error) return { ok: false, error: schedule.error };

    await db.article.update({
      where: { id: articleId },
      data: {
        title: data.title,
        dek: data.dek,
        slug,
        bodyJson: data.bodyJson as object,
        bodyHtml,
        searchText: extractSearchText(bodyHtml),
        excerpt: data.excerpt,
        // `?? null`, not the raw value: the form always sends its whole
        // state, so an absent id means "none" — clearing the section or
        // removing the cover — and undefined would tell Prisma to leave
        // the old value in place.
        categoryId: data.categoryId ?? null,
        coverImageId: data.coverImageId ?? null,
        isBreaking: data.isBreaking ?? false,
        seoTitle: data.seoTitle?.trim() || null,
        seoDescription: data.seoDescription?.trim() || null,
        ...schedule.data,
      },
    });

    await syncTags(articleId, data.tagSlugs);
    await applyCoverAlt(data);
    await recordAudit({
      actorId: session.user.id,
      action: "article.update",
      targetType: "Article",
      targetId: articleId,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/articles");
    revalidatePath(`/article/${slug}`);
    // "/" too: an edit can change the headline, dek, breaking flag or
    // category, all of which show on the homepage — and the section list
    // in the site header is built from which categories have published
    // work, so moving an article between sections changes the nav.
    revalidatePath("/");
    revalidatePublicFeeds();
    return { ok: true, id: articleId, slug };
  });
}

export async function publishArticle(articleId: string): Promise<ArticleActionResult> {
  return guardAction(async () => {
    // Publishing specifically requires a confirmed email address; drafting
    // and editing do not. See lib/auth/rbac.ts.
    const session = await requireVerifiedEmail("MODERATOR");

    const article = await db.article.findUnique({ where: { id: articleId } });
    if (!article) return { ok: false, error: "Article not found." };
    assertCanEdit(session.user.role, session.user.id, article);

    await db.article.update({
      where: { id: articleId },
      data: {
        status: "PUBLISHED",
        publishedAt: article.publishedAt ?? new Date(),
      },
    });

    // Only does anything for an article flagged breaking, and only
    // reaches readers who follow this author or section. See
    // lib/notifications.ts.
    await notifyBreakingNews(articleId);

    await recordAudit({
      actorId: session.user.id,
      action: "article.publish",
      targetType: "Article",
      targetId: articleId,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/articles");
    revalidatePath("/");
    revalidatePublicFeeds();
    revalidatePath(`/article/${article.slug}`);
    return { ok: true, id: articleId, slug: article.slug };
  });
}

export async function unpublishArticle(articleId: string): Promise<ArticleActionResult> {
  return guardAction(async () => {
    const session = await requireRole("MODERATOR");

    const article = await db.article.findUnique({ where: { id: articleId } });
    if (!article) return { ok: false, error: "Article not found." };
    assertCanEdit(session.user.role, session.user.id, article);

    await db.article.update({ where: { id: articleId }, data: { status: "DRAFT" } });

    await recordAudit({
      actorId: session.user.id,
      action: "article.unpublish",
      targetType: "Article",
      targetId: articleId,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/articles");
    revalidatePath("/");
    revalidatePublicFeeds();
    revalidatePath(`/article/${article.slug}`);
    return { ok: true, id: articleId, slug: article.slug };
  });
}

export async function archiveArticle(articleId: string): Promise<ArticleActionResult> {
  return guardAction(async () => {
    // Archiving (the closest thing to "delete" this app exposes) follows the
    // same ownership rule as publish/unpublish: moderators can archive their
    // own articles, admins can archive anyone's.
    const session = await requireRole("MODERATOR");

    const article = await db.article.findUnique({ where: { id: articleId } });
    if (!article) return { ok: false, error: "Article not found." };
    assertCanEdit(session.user.role, session.user.id, article);

    await db.article.update({ where: { id: articleId }, data: { status: "ARCHIVED" } });

    await recordAudit({
      actorId: session.user.id,
      action: "article.archive",
      targetType: "Article",
      targetId: articleId,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/articles");
    revalidatePath("/");
    revalidatePublicFeeds();
    revalidatePath(`/article/${article.slug}`);
    return { ok: true, id: articleId, slug: article.slug };
  });
}

/**
 * Refreshes the machine-readable views of what is published.
 *
 * Both are cached — the feed for 15 minutes, the sitemap for an hour — so
 * without this a newly published article is missing from the feed that
 * subscribers poll, and from the sitemap a crawler reads, for as long as
 * the cache holds. For a news site that delay is the whole point of
 * publishing.
 */
function revalidatePublicFeeds() {
  revalidatePath("/feed.xml");
  revalidatePath("/sitemap.xml");
}

const MAX_LINKS_PER_ARTICLE = 10;

export interface ArticleLinkResult {
  ok: boolean;
  error?: string;
  /** True when the link was saved but its preview couldn't be fetched. */
  previewUnavailable?: boolean;
}

/**
 * Attaches a related link to an article and caches what the linked page
 * says about itself.
 *
 * The fetch is the interesting part: this makes the *server* request a URL
 * an author typed, which is the classic SSRF setup. See
 * src/lib/linkPreview/ for how that is contained — the short version is
 * that every address the hostname resolves to must be public, the
 * connection is made to the address that was checked rather than to the
 * hostname again, every redirect hop is re-checked, and failures are
 * reported coarsely so this can't be used to map the internal network.
 */
export async function addArticleLink(input: {
  articleId: string;
  url: string;
  label?: string;
}): Promise<ArticleLinkResult> {
  return guardAction(async () => {
    const session = await requireRole("MODERATOR");

    const parsed = addArticleLinkSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link" };
    }

    const article = await db.article.findUnique({
      where: { id: parsed.data.articleId },
      select: { id: true, slug: true, authorId: true, _count: { select: { links: true } } },
    });
    if (!article) return { ok: false, error: "Article not found." };
    assertCanEdit(session.user.role, session.user.id, article);

    if (article._count.links >= MAX_LINKS_PER_ARTICLE) {
      return { ok: false, error: `An article can have at most ${MAX_LINKS_PER_ARTICLE} links.` };
    }

    // Rate limited because this triggers an outbound request from the
    // server, not merely a database write.
    const ip = await getClientIp();
    const { success } = await linkPreviewLimiter.limit(`${ip}:${session.user.id}`);
    if (!success) {
      return { ok: false, error: "Too many links at once — give it a moment." };
    }

    const preview = await fetchLinkPreview(parsed.data.url);

    await db.articleLink.create({
      data: {
        articleId: article.id,
        // The URL the author typed is what gets stored and shown. The
        // final URL after redirects is deliberately not substituted: a
        // link that quietly becomes a different address than the one the
        // author chose is worse than one that redirects in the reader's
        // own browser.
        url: parsed.data.url,
        label: parsed.data.label,
        title: preview?.title ?? null,
        description: preview?.description ?? null,
        siteName: preview?.siteName ?? null,
        fetchedAt: preview ? new Date() : null,
      },
    });

    await recordAudit({
      actorId: session.user.id,
      action: "article.link.add",
      targetType: "Article",
      targetId: article.id,
      metadata: { url: parsed.data.url, previewed: !!preview },
      ip,
    });

    revalidatePath(`/dashboard/articles/${article.id}`);
    revalidatePath(`/article/${article.slug}`);
    return { ok: true, previewUnavailable: !preview };
  });
}

export async function removeArticleLink(linkId: string): Promise<ArticleLinkResult> {
  return guardAction(async () => {
    const session = await requireRole("MODERATOR");

    const link = await db.articleLink.findUnique({
      where: { id: linkId },
      select: { id: true, article: { select: { id: true, slug: true, authorId: true } } },
    });
    if (!link) return { ok: true };
    assertCanEdit(session.user.role, session.user.id, link.article);

    await db.articleLink.delete({ where: { id: link.id } });

    await recordAudit({
      actorId: session.user.id,
      action: "article.link.remove",
      targetType: "Article",
      targetId: link.article.id,
      ip: await getClientIp(),
    });

    revalidatePath(`/dashboard/articles/${link.article.id}`);
    revalidatePath(`/article/${link.article.slug}`);
    return { ok: true };
  });
}
