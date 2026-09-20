import { describe, expect, test } from "vitest";
import { loginSchema } from "@/lib/validation/auth";

// Regression coverage for a real bug: next-auth's client signIn() serializes
// credentials through `new URLSearchParams(...)`, which turns a JS
// `undefined` value into the literal string "undefined" on the wire. That
// broke every login (not just MFA ones) once an optional `totp` field was
// added, because the schema rejected the literal string. See
// src/lib/validation/auth.ts and src/app/(auth)/login/page.tsx.
describe("loginSchema totp handling", () => {
  const base = { email: "reader@example.com", password: "correct-horse-battery-staple" };

  test("accepts a request with no totp key at all", () => {
    const result = loginSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totp).toBeUndefined();
  });

  test("treats the literal string \"undefined\" as absent", () => {
    const result = loginSchema.safeParse({ ...base, totp: "undefined" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totp).toBeUndefined();
  });

  test("treats an empty string as absent", () => {
    const result = loginSchema.safeParse({ ...base, totp: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totp).toBeUndefined();
  });

  test("accepts a real 6-digit code", () => {
    const result = loginSchema.safeParse({ ...base, totp: "123456" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totp).toBe("123456");
  });

  test("rejects a malformed code rather than silently dropping it", () => {
    const result = loginSchema.safeParse({ ...base, totp: "12" });
    expect(result.success).toBe(false);
  });
});
