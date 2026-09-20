"use server";

import { requireRole, guardAction } from "@/lib/auth/rbac";
import { saveSettings, settingsSchema } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";
import { revalidatePath } from "next/cache";

export async function updateSettings(input: unknown): Promise<{ ok: boolean; error?: string }> {
  return guardAction(async () => {
    const session = await requireRole("ADMIN");

    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };

    await saveSettings(parsed.data, session.user.id);
    await recordAudit({
      actorId: session.user.id,
      action: "settings.update",
      targetType: "SiteSetting",
      targetId: "site",
      metadata: parsed.data,
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/comments");
    return { ok: true };
  });
}
