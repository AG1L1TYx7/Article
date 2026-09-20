"use server";

import { db } from "@/lib/db";
import { requireRole, guardAction } from "@/lib/auth/rbac";
import { categoryInputSchema } from "@/lib/validation/article";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { revalidatePath } from "next/cache";

export interface CategoryActionResult {
  ok: boolean;
  error?: string;
}

export async function createCategory(formData: FormData): Promise<CategoryActionResult> {
  return guardAction(async () => {
    const session = await requireRole("ADMIN");

    const parsed = categoryInputSchema.safeParse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      description: formData.get("description") || undefined,
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const existing = await db.category.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) return { ok: false, error: "A category with that slug already exists." };

    const category = await db.category.create({ data: parsed.data });
    await recordAudit({
      actorId: session.user.id,
      action: "category.create",
      targetType: "Category",
      targetId: category.id,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/categories");
    return { ok: true };
  });
}

/**
 * Renames or re-describes a category. The slug is left alone on purpose:
 * it is in every published URL for the section, and changing it would
 * break links from outside — a rename is what people actually want.
 */
export async function updateCategory(
  categoryId: string,
  input: { name: string; description?: string }
): Promise<CategoryActionResult> {
  return guardAction(async () => {
    const session = await requireRole("ADMIN");

    const parsed = categoryInputSchema.pick({ name: true, description: true }).safeParse({
      name: input.name,
      description: input.description || undefined,
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const existing = await db.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!existing) return { ok: false, error: "That category no longer exists." };

    await db.category.update({
      where: { id: categoryId },
      data: { name: parsed.data.name, description: parsed.data.description ?? null },
    });
    await recordAudit({
      actorId: session.user.id,
      action: "category.update",
      targetType: "Category",
      targetId: categoryId,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/categories");
    revalidatePath("/");
    return { ok: true };
  });
}

export async function deleteCategory(categoryId: string): Promise<CategoryActionResult> {
  return guardAction(async () => {
    const session = await requireRole("ADMIN");

    const inUse = await db.article.count({ where: { categoryId } });
    if (inUse > 0) {
      return { ok: false, error: `${inUse} article(s) still use this category — reassign them first.` };
    }

    await db.category.delete({ where: { id: categoryId } });
    await recordAudit({
      actorId: session.user.id,
      action: "category.delete",
      targetType: "Category",
      targetId: categoryId,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/categories");
    return { ok: true };
  });
}
