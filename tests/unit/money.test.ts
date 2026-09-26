import { describe, expect, it } from "vitest";
import {
  MAX_CONTRIBUTION_PAISA,
  MIN_CONTRIBUTION_PAISA,
  contributionReference,
  formatAmount,
  isAcceptableAmount,
  membershipPeriodEnd,
  parseAmountToPaisa,
  sumPaisa,
} from "@/lib/money";

/**
 * Money.
 *
 * These are the tests that matter most in the codebase, because their
 * failure mode is silent. A wrong permission throws; a wrong total simply
 * looks plausible until somebody reconciles it against a bank statement
 * months later and cannot explain the difference.
 */

describe("parsing what somebody typed", () => {
  it("reads whole rupees", () => {
    expect(parseAmountToPaisa("500")).toBe(50_000);
  });

  it("reads paisa", () => {
    expect(parseAmountToPaisa("500.50")).toBe(50_050);
    expect(parseAmountToPaisa("0.05")).toBe(5);
    // One decimal place means tenths, not hundredths.
    expect(parseAmountToPaisa("1.5")).toBe(150);
  });

  it("accepts the ways people actually write amounts", () => {
    expect(parseAmountToPaisa("1,500")).toBe(150_000);
    expect(parseAmountToPaisa("Rs 500")).toBe(50_000);
    expect(parseAmountToPaisa("rs. 500")).toBe(50_000);
    expect(parseAmountToPaisa("NPR 500")).toBe(50_000);
    expect(parseAmountToPaisa("  500  ")).toBe(50_000);
  });

  it("refuses anything it would have to guess at", () => {
    // Saying no beats reading "5oo" as 5.
    for (const bad of ["5oo", "abc", "", "-100", "1.234", "1..2", "1,2,3.456", "1e5", "NaN"]) {
      expect(parseAmountToPaisa(bad), bad).toBeNull();
    }
  });

  it("never returns a fractional paisa", () => {
    for (const input of ["1", "1.1", "1.11", "0.01", "99999.99"]) {
      const paisa = parseAmountToPaisa(input)!;
      expect(Number.isInteger(paisa), input).toBe(true);
    }
  });

  it("does not lose a paisa to floating point", () => {
    // The bug this whole module exists to avoid: 0.1 + 0.2 !== 0.3.
    expect(parseAmountToPaisa("0.10")! + parseAmountToPaisa("0.20")!).toBe(
      parseAmountToPaisa("0.30")
    );
    expect(parseAmountToPaisa("1.10")).toBe(110);
    expect(parseAmountToPaisa("2.20")).toBe(220);
  });
});

describe("what may be accepted", () => {
  it("refuses an amount smaller than the fee to collect it", () => {
    expect(isAcceptableAmount(MIN_CONTRIBUTION_PAISA - 1)).toBe(false);
    expect(isAcceptableAmount(MIN_CONTRIBUTION_PAISA)).toBe(true);
  });

  it("refuses an extra zero", () => {
    // A cap turns a fat-fingered amount into a refusal rather than a
    // refund somebody has to process.
    expect(isAcceptableAmount(MAX_CONTRIBUTION_PAISA)).toBe(true);
    expect(isAcceptableAmount(MAX_CONTRIBUTION_PAISA + 1)).toBe(false);
  });

  it("refuses anything that is not a whole number of paisa", () => {
    expect(isAcceptableAmount(50_000.5)).toBe(false);
    expect(isAcceptableAmount(NaN)).toBe(false);
    expect(isAcceptableAmount(Infinity)).toBe(false);
    expect(isAcceptableAmount(-50_000)).toBe(false);
  });
});

describe("showing an amount", () => {
  it("drops the paisa when there are none", () => {
    expect(formatAmount(50_000)).toBe("Rs 500");
  });

  it("shows them when there are", () => {
    // Two places, always, once there are any paisa at all: "Rs 500.5"
    // reads like a truncation, and on a receipt that is a question.
    expect(formatAmount(50_050)).toBe("Rs 500.50");
  });

  it("groups the South Asian way, which is what a reader in Kathmandu expects", () => {
    // One lakh is 1,00,000 — not 100,000.
    expect(formatAmount(10_000_000)).toBe("Rs 1,00,000");
  });

  it("handles dollars for an overseas contributor", () => {
    expect(formatAmount(50_000, "USD")).toBe("$500.00");
  });

  it("shows zero rather than an empty string", () => {
    expect(formatAmount(0)).toBe("Rs 0");
  });
});

describe("adding up", () => {
  it("totals exactly, however many there are", () => {
    // A hundred gifts of Rs 0.10. In floats this drifts; in paisa it
    // cannot.
    const amounts = Array.from({ length: 100 }, () => 10);
    expect(sumPaisa(amounts)).toBe(1_000);
    expect(formatAmount(sumPaisa(amounts))).toBe("Rs 10");
  });

  it("is zero for nothing, not NaN", () => {
    expect(sumPaisa([])).toBe(0);
  });
});

describe("when a membership runs out", () => {
  it("renews on the same day of the month", () => {
    const start = new Date(Date.UTC(2026, 0, 15));
    expect(membershipPeriodEnd(start, 12).toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(membershipPeriodEnd(start, 1).toISOString().slice(0, 10)).toBe("2026-02-15");
  });

  it("lands on the last day when the next month is shorter", () => {
    // 31 January plus one month is 28 February, not 3 March.
    const jan31 = new Date(Date.UTC(2026, 0, 31));
    expect(membershipPeriodEnd(jan31, 1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("gets a leap year right", () => {
    const jan31 = new Date(Date.UTC(2028, 0, 31));
    expect(membershipPeriodEnd(jan31, 1).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("does not mutate the date it was given", () => {
    const start = new Date(Date.UTC(2026, 0, 15));
    const before = start.getTime();
    membershipPeriodEnd(start, 12);
    expect(start.getTime()).toBe(before);
  });
});

describe("the contribution reference", () => {
  const bytes = (n: number) => new Uint8Array(Array.from({ length: 8 }, (_, i) => (n + i * 37) % 256));

  it("is grouped and prefixed so it survives a bank narration", () => {
    expect(contributionReference(bytes(1))).toMatch(/^SUP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("never uses a character that is misread aloud or in handwriting", () => {
    for (let i = 0; i < 256; i++) {
      expect(contributionReference(bytes(i)).slice(4)).not.toMatch(/[OI01SZB528]/);
    }
  });
});
