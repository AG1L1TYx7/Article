/**
 * Phone numbers as text: normalising what a person types into E.164, and
 * masking a stored number for display. Pure, so it is unit tested.
 *
 * International format is required ("+977 98…", "+44 7…"). Guessing a
 * country from a local number is exactly the kind of cleverness that
 * sends a verification code to a stranger, so it is not attempted.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

/** "+44 (0)7700 900 831" → "+447700900831", or null when it is not a phone number. */
export function normalisePhone(input: string): string | null {
  let s = input.trim();
  // A leading "00" is the international prefix outside North America.
  if (s.startsWith("00")) s = "+" + s.slice(2);
  // Drop the trunk "(0)" people write after a country code.
  s = s.replace(/\(0\)/g, "");
  s = s.replace(/[\s().-]/g, "");
  if (!s.startsWith("+")) return null;
  return E164.test(s) ? s : null;
}

/**
 * "+447700900831" → "+44 ••• •••• 831": enough to recognise, not enough
 * to dial. The first two digits stand in for the country code (codes are
 * one to three digits; two is a safe amount to show), the last three are
 * kept, everything between is hidden.
 */
export function maskPhone(e164: string): string {
  const digits = e164.slice(1);
  const cc = digits.slice(0, 2);
  const tail = digits.slice(-3);
  const hidden = Math.max(3, digits.length - cc.length - tail.length);
  const dots = "•".repeat(hidden).replace(/(.{3})(?=.)/g, "$1 ");
  return `+${cc} ${dots} ${tail}`;
}

/** Six digits, as text, never starting with a zero-padded ambiguity. */
export function isSixDigitCode(input: string): boolean {
  return /^\d{6}$/.test(input.trim());
}
