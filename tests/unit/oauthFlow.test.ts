import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The signed tokens that carry consent and a pending second factor across
 * the trip to Google.
 *
 * These are the whole of the evidence that consent was given, and the
 * whole of what stands between a Google sign-in and an account protected
 * by two-factor authentication. Every test here is a property that has to
 * hold or one of those two claims is false.
 */

// The tokens are keyed on AUTH_SECRET; set it before the module loads.
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-oauth-flow-tokens-0000000000";
});

const load = async () => await import("@/lib/auth/oauthFlow");

describe("consent token", () => {
  it("records the moment consent was given", async () => {
    const { issueConsentToken, readConsentToken } = await load();
    const before = Date.now();
    const { token } = issueConsentToken();
    const acceptedAt = readConsentToken(token);

    expect(acceptedAt).toBeInstanceOf(Date);
    // Stored to the second, so allow for the truncation.
    expect(acceptedAt!.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(acceptedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("refuses a token with a tampered payload", async () => {
    const { issueConsentToken, readConsentToken } = await load();
    const { token } = issueConsentToken();
    const [body, signature] = token.split(".");

    // Re-encode the payload with a policy version the site never issued.
    const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    payload.p = "9999-01-01";
    const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");

    expect(readConsentToken(`${forged}.${signature}`)).toBeNull();
  });

  it("refuses a token signed with a different secret", async () => {
    const { issueConsentToken } = await load();
    const { token } = issueConsentToken();

    vi.resetModules();
    process.env.AUTH_SECRET = "a-completely-different-secret-11111111111111";
    const { readConsentToken } = await import("@/lib/auth/oauthFlow");
    expect(readConsentToken(token)).toBeNull();

    vi.resetModules();
    process.env.AUTH_SECRET = "test-secret-for-oauth-flow-tokens-0000000000";
  });

  it("refuses rubbish, empty and missing values", async () => {
    const { readConsentToken } = await load();
    for (const value of [undefined, null, "", ".", "abc", "a.b", "....."]) {
      expect(readConsentToken(value)).toBeNull();
    }
  });

  it("refuses an expired token", async () => {
    vi.useFakeTimers();
    try {
      const { issueConsentToken, readConsentToken } = await load();
      const { token } = issueConsentToken();
      expect(readConsentToken(token)).not.toBeNull();

      // The window is thirty minutes.
      vi.advanceTimersByTime(31 * 60 * 1000);
      expect(readConsentToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("step-up token", () => {
  const user = { id: "cuser000000000000000000001", sessionVersion: 3 };

  it("names the account it was issued for", async () => {
    const { issueStepUpToken, readStepUpToken } = await load();
    expect(readStepUpToken(issueStepUpToken(user))).toEqual({
      userId: user.id,
      sessionVersion: 3,
    });
  });

  it("cannot be moved to another account", async () => {
    const { issueStepUpToken, readStepUpToken } = await load();
    const token = issueStepUpToken(user);
    const [body, signature] = token.split(".");

    const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    payload.u = "cuser000000000000000000002";
    const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");

    expect(readStepUpToken(`${forged}.${signature}`)).toBeNull();
  });

  it("expires in five minutes, not thirty", async () => {
    vi.useFakeTimers();
    try {
      const { issueStepUpToken, readStepUpToken } = await load();
      const token = issueStepUpToken(user);

      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(readStepUpToken(token)).not.toBeNull();

      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(readStepUpToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not interchangeable with a consent token", async () => {
    // Different purposes derive different keys, so a token minted for one
    // cannot be presented as the other — otherwise anybody who could get
    // a consent token could skip a second factor with it.
    const { issueConsentToken, issueStepUpToken, readConsentToken, readStepUpToken } = await load();
    expect(readStepUpToken(issueConsentToken().token)).toBeNull();
    expect(readConsentToken(issueStepUpToken(user))).toBeNull();
  });

  it("is not interchangeable with a connect token either", async () => {
    const { issueConnectToken, issueStepUpToken, readConnectToken, readStepUpToken } = await load();
    expect(readStepUpToken(issueConnectToken(user))).toBeNull();
    expect(readConnectToken(issueStepUpToken(user))).toBeNull();
  });
});
