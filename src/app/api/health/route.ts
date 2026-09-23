import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * For uptime monitors and load balancers: 200 when the app can reach its
 * database, 503 when it cannot. Nothing about configuration or versions
 * is disclosed here — this is public and unauthenticated by design, and
 * the startup log carries the detail.
 */
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET() {
  let database: "ok" | "unreachable" = "ok";
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
  } catch {
    database = "unreachable";
  }

  const ok = database === "ok";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", database, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
