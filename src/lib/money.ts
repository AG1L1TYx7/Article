/**
 * Money, in paisa.
 *
 * Every amount this platform stores is an integer number of the smallest
 * unit — paisa for rupees, cents for dollars. Not a float, not a decimal
 * read into a JavaScript number, not a string that gets parsed somewhere.
 *
 * The reason is the oldest bug in the trade: `0.1 + 0.2 === 0.30000000000000004`.
 * A platform that collects donations and cannot add them up is finished
 * long before anybody audits it, and the failure is silent — the totals
 * look right until the day somebody reconciles them against a bank
 * statement and finds a discrepancy nobody can explain.
 *
 * So the rule is: **paisa everywhere, divide only at the edge**, in the one
 * function that formats for a person. Nothing in this file returns a
 * fractional number except `formatAmount`, which returns a string.
 *
 * Pure, with no imports, so it can be tested exhaustively.
 */

/** Smallest units per major unit. Both currencies here use 100. */
const MINOR_UNITS = 100;

/** Rs 10 — below this the gateway fee exceeds the gift. */
export const MIN_CONTRIBUTION_PAISA = 1_000;
/**
 * Rs 10,00,000. Not a policy about generosity: a cap is what turns a
 * fat-fingered extra zero into a refusal rather than into a refund
 * somebody has to process, and it is where a real anti-money-laundering
 * conversation would start.
 */
export const MAX_CONTRIBUTION_PAISA = 100_000_000;

export type Currency = "NPR" | "USD";

/**
 * Parses what somebody typed into paisa.
 *
 * Accepts "500", "500.50", "1,500" and "Rs 500", because people type all
 * of those. Rejects anything else rather than guessing — a donation form
 * that silently reads "5oo" as 5 is worse than one that says no.
 *
 * Returns null for anything unparseable, so the caller decides what to
 * tell the person; this function never throws and never rounds silently.
 */
export function parseAmountToPaisa(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    // A number arriving here is already in major units from a form; round
    // half-up at the paisa, which is what a person expects of money.
    return Math.round(input * MINOR_UNITS);
  }

  const cleaned = input
    .trim()
    .replace(/^(rs\.?|npr|\$|usd)\s*/i, "")
    .replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [major, minor = ""] = cleaned.split(".");
  const paisa = Number(major) * MINOR_UNITS + Number(minor.padEnd(2, "0"));
  return Number.isSafeInteger(paisa) ? paisa : null;
}

/** Whether an amount may be accepted. */
export function isAcceptableAmount(paisa: number): boolean {
  return (
    Number.isSafeInteger(paisa) &&
    paisa >= MIN_CONTRIBUTION_PAISA &&
    paisa <= MAX_CONTRIBUTION_PAISA
  );
}

/**
 * For a person to read.
 *
 * The only place a division happens. Nepali digit grouping is not the
 * Western one — 1,00,000 rather than 100,000 — and `en-IN` produces the
 * South Asian lakh/crore grouping that a reader in Kathmandu expects,
 * where `en-US` would produce something that looks wrong to them.
 */
export function formatAmount(paisa: number, currency: Currency = "NPR"): string {
  const major = paisa / MINOR_UNITS;
  if (currency === "NPR") {
    return `Rs ${major.toLocaleString("en-IN", {
      minimumFractionDigits: paisa % MINOR_UNITS === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `$${major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Adds amounts without ever leaving integer arithmetic.
 *
 * Exists so that no caller is tempted to write `.reduce((a, b) => a + b)`
 * over amounts they have already divided.
 */
export function sumPaisa(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/**
 * When a membership bought now runs out.
 *
 * Calendar months, not 30-day blocks: somebody who joins on the 15th
 * expects to renew on the 15th. A month shorter than the start day — 31
 * January plus one month — lands on the last day of that month rather
 * than spilling into the next, which is what every calendar does and what
 * anybody looking at the date would expect.
 */
export function membershipPeriodEnd(start: Date, intervalMonths: number): Date {
  const end = new Date(start.getTime());
  const day = end.getUTCDate();
  end.setUTCMonth(end.getUTCMonth() + intervalMonths);
  // Overflowed into the following month, which means the target month is
  // shorter than the start day. Step back to its last day.
  if (end.getUTCDate() !== day) end.setUTCDate(0);
  return end;
}

/** Human-quotable, unambiguous on a bank narration or a receipt. */
const REFERENCE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY349";

export function contributionReference(randomBytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += REFERENCE_ALPHABET[randomBytes[i]! % REFERENCE_ALPHABET.length];
    if (i === 3) out += "-";
  }
  return `SUP-${out}`;
}
