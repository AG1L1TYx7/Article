import { describe, expect, test } from "vitest";
import { assessReadiness, formatReadiness } from "@/lib/productionReadiness";

const complete = {
  DATABASE_URL: "mysql://app:pw@db:3306/news",
  AUTH_SECRET: "k8Jx2pQ9vL4mN7rT1wY6zB3cD5fG8hK0aS2dF4gH6jK9lM1nP3qR5tV7wX9yZ",
  NEXTAUTH_URL: "https://news.example.org",
  RESEND_API_KEY: "re_live_xxx",
  EMAIL_FROM: "Dispatch Report <no-reply@news.example.org>",
  S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  S3_BUCKET: "media",
  MEDIA_PUBLIC_BASE_URL: "https://media.news.example.org",
  UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok",
  TURNSTILE_SECRET_KEY: "s",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k",
  CLAMAV_HOST: "clamav",
  VAPID_PUBLIC_KEY: "p",
  VAPID_PRIVATE_KEY: "q",
  TWILIO_ACCOUNT_SID: "AC",
  TWILIO_AUTH_TOKEN: "t",
  TWILIO_FROM: "+15005550006",
  LEGAL_ENTITY: "Dispatch Media Ltd",
  LEGAL_ADDRESS: "1 Fleet Street",
  LEGAL_CONTACT_EMAIL: "legal@news.example.org",
};

const areas = (items: { area: string }[]) => items.map((i) => i.area);

describe("assessReadiness", () => {
  test("a complete configuration has no blockers and no warnings", () => {
    const r = assessReadiness(complete, { ffmpegAvailable: true });
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok.length).toBeGreaterThan(8);
  });

  test("a laptop .env in production is a wall of blockers, each with a fix", () => {
    const r = assessReadiness({ DATABASE_URL: "mysql://root@127.0.0.1:3307/news_platform", AUTH_SECRET: "generate-with: openssl rand -base64 32", NEXTAUTH_URL: "http://localhost:3000" });
    expect(areas(r.blockers)).toEqual(["Auth secret", "Public address", "Email"]);
    for (const b of r.blockers) expect(b.fix.length).toBeGreaterThan(10);
  });

  test("email is a blocker, not a warning: without it nobody can recover an account", () => {
    const r = assessReadiness({ ...complete, RESEND_API_KEY: "" });
    expect(areas(r.blockers)).toEqual(["Email"]);
    expect(r.blockers[0]!.problem).toMatch(/never delivered/);
  });

  test("the example sender address does not count as configured", () => {
    const r = assessReadiness({ ...complete, EMAIL_FROM: "News Platform <no-reply@example.com>" });
    expect(areas(r.blockers)).toEqual(["Email"]);
  });

  test("the public address must be https and not localhost", () => {
    expect(areas(assessReadiness({ ...complete, NEXTAUTH_URL: "http://news.example.org" }).blockers)).toEqual(["Public address"]);
    expect(areas(assessReadiness({ ...complete, NEXTAUTH_URL: "https://localhost:3000" }).blockers)).toEqual(["Public address"]);
    expect(areas(assessReadiness({ ...complete, NEXTAUTH_URL: "not a url" }).blockers)).toEqual(["Public address"]);
    // SITE_URL, when set, is what readers see and what is checked.
    expect(assessReadiness({ ...complete, NEXTAUTH_URL: "http://localhost:3000", SITE_URL: "https://news.example.org" }).blockers).toEqual([]);
  });

  test("a short or placeholder secret is refused", () => {
    expect(areas(assessReadiness({ ...complete, AUTH_SECRET: "tooshort" }).blockers)).toEqual(["Auth secret"]);
    expect(areas(assessReadiness({ ...complete, AUTH_SECRET: "change-me-change-me-change-me-change-me" }).blockers)).toEqual(["Auth secret"]);
    expect(areas(assessReadiness({ ...complete, AUTH_SECRET: "" }).blockers)).toEqual(["Auth secret"]);
  });

  test("local fallbacks that still work are warnings, with the multi-instance caveat spelled out", () => {
    const r = assessReadiness({ ...complete, S3_BUCKET: "", UPSTASH_REDIS_REST_URL: "", CLAMAV_HOST: "", TURNSTILE_SECRET_KEY: "", VAPID_PUBLIC_KEY: "", TWILIO_FROM: "", LEGAL_ADDRESS: "" }, { ffmpegAvailable: false });
    expect(r.blockers).toEqual([]);
    expect(areas(r.warnings)).toEqual([
      "Object storage",
      "Rate limiting",
      "Registration CAPTCHA",
      "Malware scanning",
      "Video and audio",
      "Push notifications",
      "Phone verification",
      "Legal pages",
    ]);
    expect(r.warnings.find((w) => w.area === "Rate limiting")!.problem).toMatch(/multiplied by the instance count/);
    expect(r.warnings.find((w) => w.area === "Legal pages")!.problem).toContain("LEGAL_ADDRESS");
  });

  test("S3 without a public base URL is called out on its own", () => {
    const r = assessReadiness({ ...complete, MEDIA_PUBLIC_BASE_URL: "" });
    expect(areas(r.warnings)).toEqual(["Object storage"]);
    expect(r.warnings[0]!.problem).toMatch(/MEDIA_PUBLIC_BASE_URL/);
  });
});

describe("formatReadiness", () => {
  test("says READY or NOT READY first, then every item with its fix", () => {
    const good = formatReadiness(assessReadiness(complete, { ffmpegAvailable: true }));
    expect(good.startsWith("READY")).toBe(true);
    const bad = formatReadiness(assessReadiness({ ...complete, RESEND_API_KEY: "" }));
    expect(bad.startsWith("NOT READY — 1 blocker:")).toBe(true);
    expect(bad).toContain("→ Set RESEND_API_KEY");
  });
});
