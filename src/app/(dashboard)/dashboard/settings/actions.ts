"use server";

import { z } from "zod";
import { requireRole, requirePermission, guardAction } from "@/lib/auth/rbac";
import { saveSettings, settingsSchema } from "@/lib/settings";
import { explainSmtpError, saveSmtpConfig, verifySmtp } from "@/lib/smtp";
import { smtpConfigSchema } from "@/lib/smtpConfig";
import { saveSupportSettings } from "@/lib/contributions";
import { isPayable, supportSettingsSchema } from "@/lib/supportSettings";
import { sendEmail } from "@/lib/email";
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

/**
 * Saves the mail server settings.
 *
 * `password: undefined` leaves the stored one alone — that is what the
 * form sends when the administrator did not retype it, so saving an
 * unrelated change does not wipe a working password. An explicit empty
 * string clears it, for a relay that authenticates by IP.
 *
 * The password is never echoed back and never appears in the audit
 * metadata below. Recording *that* it changed is the useful fact; putting
 * the value in an append-only table nobody can edit would be the opposite
 * of careful.
 */
export async function updateSmtpSettings(
  input: unknown,
  password: string | undefined
): Promise<{ ok: boolean; error?: string }> {
  return guardAction(async () => {
    const session = await requirePermission("settings.manage");

    const parsed = smtpConfigSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };

    await saveSmtpConfig(parsed.data, password, session.user.id);
    await recordAudit({
      actorId: session.user.id,
      action: "settings.smtp.update",
      targetType: "SiteSetting",
      targetId: "smtp",
      metadata: {
        enabled: parsed.data.enabled,
        host: parsed.data.host,
        port: parsed.data.port,
        secure: parsed.data.secure,
        user: parsed.data.user,
        fromEmail: parsed.data.fromEmail,
        passwordChanged: password !== undefined,
      },
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/settings");
    return { ok: true };
  });
}

/**
 * Connects, authenticates, and sends one message to the address given.
 *
 * Worth its own button because the alternative way to discover that mail
 * is broken is somebody failing to reset their password at midnight. The
 * error is reported in full — `rethrow` on the send — since an
 * administrator who cannot see why it failed cannot fix it.
 */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  return guardAction(async () => {
    await requirePermission("settings.manage");

    const address = z.email().safeParse(to.trim());
    if (!address.success) return { ok: false, error: "Enter an address to send the test to." };

    const check = await verifySmtp();
    if (!check.ok) return { ok: false, error: check.error };

    try {
      await sendEmail(
        {
          to: address.data,
          subject: "Test message from The Dispatch",
          html:
            "<p>This is a test of the mail settings.</p>" +
            "<p>If you are reading it, password resets, email verification and " +
            "sign-in codes will reach people the same way.</p>",
        },
        { rethrow: true }
      );
    } catch (err) {
      return { ok: false, error: explainSmtpError(err) };
    }

    return { ok: true };
  });
}

/**
 * Where contributors are told to send money.
 *
 * Behind `membership.manage` rather than `settings.manage`, because this
 * is the most abusable form on the site: whoever can change these fields
 * can redirect every donation to an account of their choosing. The audit
 * row records the account number that was set, so a change can be seen
 * afterwards rather than merely suspected.
 */
export async function updateSupportSettings(input: unknown): Promise<{ ok: boolean; error?: string }> {
  return guardAction(async () => {
    const session = await requirePermission("membership.manage");

    const parsed = supportSettingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };

    // Refused rather than saved: a page that asks for money and cannot say
    // where to send it is worse than no page.
    if (parsed.data.enabled && !isPayable(parsed.data)) {
      return {
        ok: false,
        error:
          "Fill in either the bank details (name, account name and number) or a wallet before switching this on.",
      };
    }

    await saveSupportSettings(parsed.data, session.user.id);
    await recordAudit({
      actorId: session.user.id,
      action: "settings.support.update",
      targetType: "SiteSetting",
      targetId: "support",
      metadata: {
        enabled: parsed.data.enabled,
        bankName: parsed.data.bankName,
        accountName: parsed.data.accountName,
        accountNumber: parsed.data.accountNumber,
        walletId: parsed.data.walletId,
        showSupporters: parsed.data.showSupporters,
      },
      ip: await getClientIp(),
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/support");
    return { ok: true };
  });
}
