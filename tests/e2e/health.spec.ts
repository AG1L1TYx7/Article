import { test, expect } from "@playwright/test";

/**
 * The endpoint an uptime monitor watches. Public, unauthenticated, and
 * says nothing about how the site is configured.
 */
test("the health endpoint answers 200 with the database reachable, and is never cached", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = (await response.json()) as { status: string; database: string; uptimeSeconds: number };
  expect(body.status).toBe("ok");
  expect(body.database).toBe("ok");
  expect(typeof body.uptimeSeconds).toBe("number");
  // Nothing about configuration leaks through it.
  expect(JSON.stringify(body)).not.toMatch(/resend|s3|upstash|secret/i);
});
