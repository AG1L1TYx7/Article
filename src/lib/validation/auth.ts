import { z } from "zod";

// Password policy: length over composition rules (see security blueprint —
// composition rules push users toward predictable substitutions; length is
// what actually resists brute force). Breach checking happens separately
// against the HaveIBeenPwned range API, not here.
const password = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(256);

const handle = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_-]+$/, "Handle can only contain lowercase letters, numbers, - and _");

export const registerSchema = z.object({
  name: z.string().min(1).max(120),
  handle,
  email: z.email().max(254),
  password,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
  // Present only when the account has MFA enabled — see the two-step login
  // flow in app/(auth)/login/actions.ts and the authorize() callback in
  // lib/auth/config.ts. Credentials cross the wire through next-auth's
  // client signIn(), which serializes them with `new URLSearchParams(...)`
  // — that turns a JS `undefined` into the literal string "undefined", so
  // an absent code must be tolerated as text, not just as a missing key.
  // (A real bug: this rejected every login, MFA or not, until both this
  // schema and the caller were fixed to agree on what "no code" looks
  // like on the wire.)
  // Either the six-digit authenticator code, or one of the eight-character
  // recovery codes (dash optional) — see lib/auth/recoveryCodes.ts.
  totp: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "undefined" || v === "" ? undefined : v.trim()))
    .refine(
      (v) => v === undefined || /^\d{6}$/.test(v) || /^[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(v),
      "Enter the 6-digit code or a recovery code"
    ),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaCodeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");
