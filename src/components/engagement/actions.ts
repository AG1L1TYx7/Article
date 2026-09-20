"use server";

import { db } from "@/lib/db";
import { requireUser, guardAction } from "@/lib/auth/rbac";
import { engagementLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { revalidatePath } from "next/cache";

// Liking, saving and following only require a signed-in account, not a
// verified email — the security blueprint reserves the verification gate
// for publishing, commenting and uploading. These actions create nothing
// another reader can see, so the bar is lower.

export interface ToggleResult {
  ok: boolean;
  active?: boolean;
  count?: number;
  error?: string;
}

async function checkLimit(userId: string): Promise<boolean> {
  const ip = await getClientIp();
  const { success } = await engagementLimiter.limit(`${ip}:${userId}`);
  return success;
}

export async function toggleArticleLike(articleId: string): Promise<ToggleResult> {
  return guardAction(async () => {
    const session = await requireUser();
    if (!(await checkLimit(session.user.id))) {
      return { ok: false, error: "Slow down a moment." };
    }

    const article = await db.article.findFirst({
      where: { id: articleId, status: "PUBLISHED" },
      select: { slug: true },
    });
    if (!article) return { ok: false, error: "That article isn't available." };

    // findFirst rather than findUnique: articleId is nullable on Reaction
    // (the same table holds comment likes), and a compound unique with a
    // nullable column isn't addressable through findUnique.
    const existing = await db.reaction.findFirst({
      where: { userId: session.user.id, articleId },
      select: { id: true },
    });

    if (existing) await db.reaction.delete({ where: { id: existing.id } });
    else await db.reaction.create({ data: { userId: session.user.id, articleId, type: "LIKE" } });

    const count = await db.reaction.count({ where: { articleId } });
    revalidatePath(`/article/${article.slug}`);
    return { ok: true, active: !existing, count };
  });
}

export async function toggleCommentLike(commentId: string): Promise<ToggleResult> {
  return guardAction(async () => {
    const session = await requireUser();
    if (!(await checkLimit(session.user.id))) {
      return { ok: false, error: "Slow down a moment." };
    }

    const comment = await db.comment.findFirst({
      where: { id: commentId, status: "APPROVED" },
      select: { id: true },
    });
    if (!comment) return { ok: false, error: "That comment isn't available." };

    const existing = await db.reaction.findFirst({
      where: { userId: session.user.id, commentId },
      select: { id: true },
    });

    if (existing) await db.reaction.delete({ where: { id: existing.id } });
    else await db.reaction.create({ data: { userId: session.user.id, commentId, type: "LIKE" } });

    const count = await db.reaction.count({ where: { commentId } });
    return { ok: true, active: !existing, count };
  });
}

export async function toggleBookmark(articleId: string): Promise<ToggleResult> {
  return guardAction(async () => {
    const session = await requireUser();
    if (!(await checkLimit(session.user.id))) {
      return { ok: false, error: "Slow down a moment." };
    }

    const article = await db.article.findFirst({
      where: { id: articleId, status: "PUBLISHED" },
      select: { id: true },
    });
    if (!article) return { ok: false, error: "That article isn't available." };

    const existing = await db.bookmark.findFirst({
      where: { userId: session.user.id, articleId },
      select: { id: true },
    });

    if (existing) await db.bookmark.delete({ where: { id: existing.id } });
    else await db.bookmark.create({ data: { userId: session.user.id, articleId } });

    revalidatePath("/saved");
    return { ok: true, active: !existing };
  });
}

export async function toggleFollowCategory(categoryId: string): Promise<ToggleResult> {
  return guardAction(async () => {
    const session = await requireUser();
    if (!(await checkLimit(session.user.id))) {
      return { ok: false, error: "Slow down a moment." };
    }

    const category = await db.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) return { ok: false, error: "That section isn't available." };

    const existing = await db.follow.findFirst({
      where: { followerId: session.user.id, categoryId },
      select: { id: true },
    });

    if (existing) await db.follow.delete({ where: { id: existing.id } });
    else await db.follow.create({ data: { followerId: session.user.id, categoryId } });

    revalidatePath("/following");
    return { ok: true, active: !existing };
  });
}

export async function toggleFollowAuthor(authorId: string): Promise<ToggleResult> {
  return guardAction(async () => {
    const session = await requireUser();
    if (!(await checkLimit(session.user.id))) {
      return { ok: false, error: "Slow down a moment." };
    }
    if (authorId === session.user.id) {
      return { ok: false, error: "You can't follow yourself." };
    }

    const author = await db.user.findFirst({
      where: { id: authorId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!author) return { ok: false, error: "That author isn't available." };

    const existing = await db.follow.findFirst({
      where: { followerId: session.user.id, authorId },
      select: { id: true },
    });

    if (existing) await db.follow.delete({ where: { id: existing.id } });
    else await db.follow.create({ data: { followerId: session.user.id, authorId } });

    revalidatePath("/following");
    return { ok: true, active: !existing };
  });
}
