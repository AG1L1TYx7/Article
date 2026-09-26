import { z } from "zod";

/**
 * Where contributors are told to send money.
 *
 * Not secret — the whole point is to publish it — but it is the single
 * most abusable thing on the site: whoever can change these fields can
 * redirect every donation to their own account. So it sits behind
 * `membership.manage`, every change is audit-logged, and the public page
 * shows nothing at all until it is filled in. A half-configured page that
 * says "Bank: " and an empty line is how somebody sends money nowhere.
 *
 * Pure, with only Zod, so the settings form can import the shape without
 * importing the database. Reading and writing live in lib/contributions.ts.
 */

export const supportSettingsSchema = z.object({
  /** Off by default. Nothing about giving appears anywhere until this is on. */
  enabled: z.boolean(),
  /** The organisation as it appears on the bank account and on receipts. */
  organisationName: z.string().trim().max(200),
  bankName: z.string().trim().max(200),
  accountName: z.string().trim().max(200),
  accountNumber: z.string().trim().max(60),
  branch: z.string().trim().max(200),
  /** eSewa or Khalti ID, for people who would rather use a wallet. */
  walletName: z.string().trim().max(60),
  walletId: z.string().trim().max(60),
  /** Anything else a contributor needs to know, shown verbatim. */
  instructions: z.string().trim().max(2000),
  /**
   * Whether to show a public list of people who gave.
   *
   * Off by default, deliberately. On a platform whose sectors include
   * corruption, a list of who funds the work is a list of people who can
   * be leaned on — and in a small district that is not a hypothetical.
   * Turning it on should be a decision somebody makes, not a default they
   * inherit.
   */
  showSupporters: z.boolean(),
});

export type SupportSettings = z.infer<typeof supportSettingsSchema>;

export const DEFAULT_SUPPORT: SupportSettings = {
  enabled: false,
  organisationName: "",
  bankName: "",
  accountName: "",
  accountNumber: "",
  branch: "",
  walletName: "",
  walletId: "",
  instructions: "",
  showSupporters: false,
};

/**
 * Whether there is enough here to ask anybody for money.
 *
 * A bank name alone is not payable. Requiring the account name and number
 * together means the page either tells somebody exactly where to send a
 * transfer or does not appear at all.
 */
export function isPayable(settings: SupportSettings): boolean {
  const hasBank = !!(settings.bankName && settings.accountName && settings.accountNumber);
  const hasWallet = !!(settings.walletName && settings.walletId);
  return settings.enabled && (hasBank || hasWallet);
}
