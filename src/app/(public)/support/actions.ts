"use server";

import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { ContributionError, getSupportSettings, pledge } from "@/lib/contributions";
import { isPayable } from "@/lib/supportSettings";
import { parseAmountToPaisa } from "@/lib/money";
import { commentLimiter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { recordAudit } from "@/lib/audit";

/**
 * Somebody says they are going to give.
 *
 * No money moves here. This records the intention and hands back a
 * reference to quote on the transfer, so the treasurer looking at a bank
 * statement full of deposits can tell which is which. Confirmation is a
 * separate, human act — see lib/contributions.ts.
 *
 * Open to people who are not signed in. Requiring an account before
 * somebody can give would lose contributions for no benefit: the bank
 * transfer is the real identity check, and a name typed into this form is
 * only ever a label for a receipt.
 */

const pledgeSchema = z.object({
  kind: z.enum(["ONE_OFF", "MEMBERSHIP"]),
  tierId: z.string().trim().optional(),
  /** Free text, because people type "Rs 500" and "1,500". See lib/money.ts. */
  amount: z.string().trim().optional(),
  donorName: z.string().trim().max(120).optional(),
  donorEmail: z.union([z.email().max(254), z.literal("")]).optional(),
  anonymous: z.boolean(),
  message: z.string().trim().max(1000).optional(),
});

export interface PledgeResult {
  ok: boolean;
  error?: string;
  reference?: string;
}

export async function pledgeAction(input: unknown): Promise<PledgeResult> {
  const settings = await getSupportSettings();
  // Refused rather than accepted-and-lost: with nowhere to send money, a
  // pledge is a row nobody can ever act on.
  if (!isPayable(settings)) {
    return { ok: false, error: "Contributions are not being accepted at the moment." };
  }

  const ip = await getClientIp();
  const { success } = await commentLimiter.limit(ip);
  if (!success) return { ok: false, error: "Too many attempts just now. Try again in a few minutes." };

  const parsed = pledgeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const session = await auth();

  let amountPaisa = 0;
  if (parsed.data.kind === "ONE_OFF") {
    const amount = parseAmountToPaisa(parsed.data.amount ?? "");
    if (amount === null) {
      // Deliberately specific: "invalid amount" sends somebody round in
      // circles retyping the same thing.
      return { ok: false, error: "Enter an amount in rupees, like 500 or 1,500." };
    }
    amountPaisa = amount;
  }

  try {
    const created = await pledge({
      kind: parsed.data.kind,
      tierId: parsed.data.tierId || null,
      amountPaisa,
      userId: session?.user?.id ?? null,
      donorName: parsed.data.donorName || session?.user?.name || null,
      donorEmail: parsed.data.donorEmail || session?.user?.email || null,
      anonymous: parsed.data.anonymous,
      message: parsed.data.message || null,
    });

    // The reference and the amount, never the name or the message. An
    // audit row is readable by every administrator, and who gave what is
    // for the people who keep the books.
    await recordAudit({
      actorId: session?.user?.id ?? created.id,
      action: "contribution.pledge",
      targetType: "Contribution",
      targetId: created.id,
      metadata: { reference: created.reference, amountPaisa: created.amountPaisa, kind: created.kind },
      ip,
    });

    return { ok: true, reference: created.reference };
  } catch (err) {
    if (err instanceof ContributionError) return { ok: false, error: err.message };
    throw err;
  }
}

/** A contributor checking what happened to their own pledge. */
export async function lookupPledge(reference: string): Promise<{
  ok: boolean;
  status?: string;
  error?: string;
}> {
  const trimmed = reference.trim().toUpperCase();
  if (!/^SUP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(trimmed)) {
    return { ok: false, error: "That does not look like a reference. They look like SUP-ABCD-1234." };
  }

  const { success } = await commentLimiter.limit(await getClientIp());
  if (!success) return { ok: false, error: "Too many lookups. Try again in a few minutes." };

  const row = await db.contribution.findUnique({
    where: { reference: trimmed },
    // Status only. The reference is guessable enough that this must not
    // become a way to read somebody else's name, amount or message.
    select: { status: true },
  });
  if (!row) return { ok: false, error: "No contribution with that reference." };
  return { ok: true, status: row.status };
}
