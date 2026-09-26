import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import {
  contributionReference,
  isAcceptableAmount,
  membershipPeriodEnd,
  sumPaisa,
} from "@/lib/money";
import {
  DEFAULT_SUPPORT,
  supportSettingsSchema,
  type SupportSettings,
} from "@/lib/supportSettings";

/**
 * Memberships and donations, collected by bank transfer and confirmed by
 * hand.
 *
 * There is no payment gateway here, and that is a decision rather than a
 * gap. A contributor is shown where to send money and a reference to quote;
 * a treasurer marks it received once it appears in the account. It needs no
 * merchant agreement, costs nothing per transaction, puts this platform
 * entirely outside PCI scope, and is how most civic groups in Nepal
 * actually start. A gateway can be added later behind `provider` without
 * any of the rest of this changing.
 *
 * Two rules run through everything below.
 *
 * **Nothing is money until somebody says it is.** A pledge is a statement
 * of intent typed into a form by anybody at all. Only a human with
 * `contribution.confirm`, looking at a bank statement, moves it to
 * CONFIRMED — and only CONFIRMED rows count towards any total shown
 * anywhere.
 *
 * **Records are permanent.** Nothing here is ever deleted. A refund is a
 * status, not a deletion and not a negative amount; a donor closing their
 * account unlinks the row rather than removing it. An organisation that
 * collects money has to be able to account for what it received long after
 * the people involved have moved on.
 */

export const MANUAL_PROVIDER = "manual";

function newReference(): string {
  return contributionReference(randomBytes(8));
}

export interface PledgeInput {
  amountPaisa: number;
  kind: "ONE_OFF" | "MEMBERSHIP";
  tierId?: string | null;
  /** Null for somebody not signed in. */
  userId?: string | null;
  donorName?: string | null;
  donorEmail?: string | null;
  anonymous: boolean;
  message?: string | null;
}

export class ContributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContributionError";
  }
}

/**
 * Records an intention to give, and returns the reference to quote.
 *
 * Deliberately creates a row before any money moves. Without it there is
 * nothing for the bank narration to refer to, and a treasurer looking at a
 * statement full of transfers has no way to tell which is which.
 *
 * The amount is taken from the tier for a membership rather than from the
 * form: a form can post any number, and a membership that cost what the
 * browser said it cost is not a membership.
 */
export async function pledge(input: PledgeInput) {
  let amountPaisa = input.amountPaisa;
  let tier = null;

  if (input.kind === "MEMBERSHIP") {
    if (!input.tierId) throw new ContributionError("Choose a membership.");
    tier = await db.membershipTier.findUnique({
      where: { id: input.tierId },
      select: { id: true, amountPaisa: true, currency: true, intervalMonths: true, isActive: true },
    });
    if (!tier || !tier.isActive) throw new ContributionError("That membership is not available.");
    amountPaisa = tier.amountPaisa;
  }

  if (!isAcceptableAmount(amountPaisa)) {
    throw new ContributionError("That amount cannot be accepted. Check it and try again.");
  }

  // An anonymous contribution stores no name at all, rather than storing
  // one and hiding it. There is then nothing to leak and nothing to erase.
  const donorName = input.anonymous ? null : (input.donorName?.trim() || null);

  return db.contribution.create({
    data: {
      reference: newReference(),
      kind: input.kind,
      status: "PENDING",
      userId: input.userId || null,
      donorName,
      donorEmail: input.donorEmail?.trim() || null,
      anonymous: input.anonymous,
      amountPaisa,
      currency: tier?.currency ?? "NPR",
      tierId: tier?.id ?? null,
      provider: MANUAL_PROVIDER,
      message: input.message?.trim() || null,
    },
    select: { id: true, reference: true, amountPaisa: true, currency: true, kind: true },
  });
}

/**
 * Marks money as received.
 *
 * The moment a pledge becomes a fact. For a membership it also sets the
 * period, starting from confirmation rather than from the pledge — somebody
 * who transfers a week late should get a full year, not a year minus a
 * week.
 *
 * Refuses a contribution that is not PENDING, so a double-click or two
 * treasurers working the same list cannot confirm the same money twice and
 * inflate a total.
 */
export async function confirmContribution(params: {
  contributionId: string;
  actorId: string;
  /** The bank's own reference, so the row can be tied to a statement line. */
  providerRef?: string | null;
  staffNote?: string | null;
}) {
  const contribution = await db.contribution.findUnique({
    where: { id: params.contributionId },
    select: {
      id: true,
      status: true,
      kind: true,
      tier: { select: { intervalMonths: true } },
    },
  });
  if (!contribution) throw new ContributionError("That contribution no longer exists.");
  if (contribution.status !== "PENDING") {
    throw new ContributionError(
      `That contribution is already ${contribution.status.toLowerCase()}. It cannot be confirmed again.`
    );
  }

  const now = new Date();
  const months = contribution.tier?.intervalMonths ?? 12;

  await db.contribution.update({
    where: { id: contribution.id },
    data: {
      status: "CONFIRMED",
      confirmedById: params.actorId,
      confirmedAt: now,
      providerRef: params.providerRef?.trim() || null,
      staffNote: params.staffNote?.trim() || null,
      ...(contribution.kind === "MEMBERSHIP"
        ? { periodStart: now, periodEnd: membershipPeriodEnd(now, months) }
        : {}),
    },
  });
}

/** The money did not arrive, or the pledge was abandoned. */
export async function failContribution(params: {
  contributionId: string;
  actorId: string;
  staffNote?: string | null;
}) {
  const contribution = await db.contribution.findUnique({
    where: { id: params.contributionId },
    select: { status: true },
  });
  if (!contribution) throw new ContributionError("That contribution no longer exists.");
  if (contribution.status !== "PENDING") {
    throw new ContributionError("Only a pending contribution can be marked as not received.");
  }

  await db.contribution.update({
    where: { id: params.contributionId },
    data: { status: "FAILED", confirmedById: params.actorId, staffNote: params.staffNote?.trim() || null },
  });
}

/**
 * Money given back.
 *
 * A status, never a deletion and never a negative row. The original
 * contribution keeps its amount and its date, because that is what
 * happened; the refund is the fact that it was later returned.
 */
export async function refundContribution(params: {
  contributionId: string;
  actorId: string;
  staffNote: string;
}) {
  const contribution = await db.contribution.findUnique({
    where: { id: params.contributionId },
    select: { status: true },
  });
  if (!contribution) throw new ContributionError("That contribution no longer exists.");
  if (contribution.status !== "CONFIRMED") {
    throw new ContributionError("Only a confirmed contribution can be refunded.");
  }
  if (!params.staffNote.trim()) {
    throw new ContributionError("Say why it was refunded. This is a financial record.");
  }

  await db.contribution.update({
    where: { id: params.contributionId },
    data: {
      status: "REFUNDED",
      refundedAt: new Date(),
      confirmedById: params.actorId,
      staffNote: params.staffNote.trim(),
    },
  });
}

/**
 * Totals, for showing publicly.
 *
 * CONFIRMED only. A pledged-but-unpaid total is a number somebody typed
 * into a form, and publishing it as "raised" would be a claim the
 * organisation cannot substantiate.
 */
export async function confirmedTotals(since?: Date) {
  const rows = await db.contribution.findMany({
    where: {
      status: "CONFIRMED",
      currency: "NPR",
      ...(since ? { confirmedAt: { gte: since } } : {}),
    },
    select: { amountPaisa: true },
  });
  return { count: rows.length, totalPaisa: sumPaisa(rows.map((r) => r.amountPaisa)) };
}

/** Contributors who agreed to be named, newest first. */
export async function publicSupporters(take = 50) {
  return db.contribution.findMany({
    where: { status: "CONFIRMED", anonymous: false, donorName: { not: null } },
    orderBy: { confirmedAt: "desc" },
    take,
    // Deliberately no amount: a public list of who gave how much turns
    // support into a ranking, and in a small district it says more about
    // people's means than they agreed to share.
    select: { id: true, donorName: true, confirmedAt: true, kind: true },
  });
}

/** Whether somebody's membership is current. */
export async function currentMembership(userId: string) {
  return db.contribution.findFirst({
    where: {
      userId,
      kind: "MEMBERSHIP",
      status: "CONFIRMED",
      periodEnd: { gte: new Date() },
    },
    orderBy: { periodEnd: "desc" },
    select: { id: true, reference: true, periodStart: true, periodEnd: true, tier: { select: { name: true } } },
  });
}

/** The treasurer's list. Gated by `contribution.view` at the call site. */
export async function listContributions(status?: "PENDING" | "CONFIRMED" | "FAILED" | "REFUNDED") {
  return db.contribution.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      reference: true,
      kind: true,
      status: true,
      amountPaisa: true,
      currency: true,
      donorName: true,
      donorEmail: true,
      anonymous: true,
      message: true,
      staffNote: true,
      providerRef: true,
      createdAt: true,
      confirmedAt: true,
      periodEnd: true,
      user: { select: { name: true, handle: true, email: true } },
      tier: { select: { name: true } },
      confirmedBy: { select: { name: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Where to send the money

const SUPPORT_KEY = "support.config";

/**
 * The bank details shown to contributors.
 *
 * Cached for a minute like the other settings — they change a few times a
 * year, and a donation page should not pay a query for them.
 */
let supportCache: { at: number; value: SupportSettings } | null = null;

export function resetSupportCache() {
  supportCache = null;
}

export async function getSupportSettings(): Promise<SupportSettings> {
  if (supportCache && Date.now() - supportCache.at < 60_000) return supportCache.value;
  const row = await db.siteSetting.findUnique({ where: { key: SUPPORT_KEY } });
  const parsed = supportSettingsSchema.safeParse(row?.value ?? {});
  const value = parsed.success ? parsed.data : DEFAULT_SUPPORT;
  supportCache = { at: Date.now(), value };
  return value;
}

export async function saveSupportSettings(next: SupportSettings, updatedBy: string): Promise<void> {
  await db.siteSetting.upsert({
    where: { key: SUPPORT_KEY },
    create: { key: SUPPORT_KEY, value: next, updatedBy },
    update: { value: next, updatedBy },
  });
  resetSupportCache();
}

/** Memberships somebody may buy, in the order they should be shown. */
export async function listActiveTiers() {
  return db.membershipTier.findMany({
    where: { isActive: true },
    orderBy: [{ sort: "asc" }, { amountPaisa: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      amountPaisa: true,
      currency: true,
      intervalMonths: true,
    },
  });
}

/** Every tier, including retired ones, for the admin screen. */
export async function listAllTiers() {
  return db.membershipTier.findMany({
    orderBy: [{ sort: "asc" }, { amountPaisa: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      amountPaisa: true,
      currency: true,
      intervalMonths: true,
      isActive: true,
      sort: true,
      _count: { select: { contributions: true } },
    },
  });
}

export async function createTier(input: {
  key: string;
  name: string;
  description: string | null;
  amountPaisa: number;
  intervalMonths: number;
  sort: number;
}) {
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(key)) {
    throw new ContributionError("The identifier must be 3–40 lowercase letters, numbers or hyphens.");
  }
  if (!input.name.trim()) throw new ContributionError("Give the membership a name.");
  if (!isAcceptableAmount(input.amountPaisa)) {
    throw new ContributionError("That amount cannot be accepted. Check it and try again.");
  }
  if (input.intervalMonths < 1 || input.intervalMonths > 60) {
    throw new ContributionError("A membership runs for between 1 and 60 months.");
  }
  if (await db.membershipTier.findUnique({ where: { key }, select: { id: true } })) {
    throw new ContributionError("A membership with that identifier already exists.");
  }

  return db.membershipTier.create({
    data: {
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      amountPaisa: input.amountPaisa,
      intervalMonths: input.intervalMonths,
      sort: input.sort,
    },
    select: { id: true, key: true, name: true },
  });
}

/**
 * Changes a membership.
 *
 * The price may change; what somebody already paid does not. A
 * contribution records its own amount at the time, so editing a tier never
 * rewrites history — which is why a tier is retired rather than deleted.
 */
export async function updateTier(
  tierId: string,
  input: {
    name: string;
    description: string | null;
    amountPaisa: number;
    intervalMonths: number;
    isActive: boolean;
    sort: number;
  }
) {
  if (!input.name.trim()) throw new ContributionError("Give the membership a name.");
  if (!isAcceptableAmount(input.amountPaisa)) {
    throw new ContributionError("That amount cannot be accepted. Check it and try again.");
  }
  if (input.intervalMonths < 1 || input.intervalMonths > 60) {
    throw new ContributionError("A membership runs for between 1 and 60 months.");
  }

  await db.membershipTier.update({
    where: { id: tierId },
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      amountPaisa: input.amountPaisa,
      intervalMonths: input.intervalMonths,
      isActive: input.isActive,
      sort: input.sort,
    },
  });
}

/**
 * Retires a membership, or removes one nobody ever bought.
 *
 * A tier that has contributions against it is never deleted: those rows
 * name it, and a receipt that cannot say what was bought is not a receipt.
 * Deactivating takes it off the support page, which is what "delete"
 * actually means here.
 */
export async function retireTier(tierId: string) {
  const tier = await db.membershipTier.findUnique({
    where: { id: tierId },
    select: { _count: { select: { contributions: true } } },
  });
  if (!tier) return;

  if (tier._count.contributions > 0) {
    await db.membershipTier.update({ where: { id: tierId }, data: { isActive: false } });
    return;
  }
  await db.membershipTier.delete({ where: { id: tierId } });
}
