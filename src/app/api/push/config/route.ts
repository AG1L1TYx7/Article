import { NextResponse } from "next/server";
import { pushEnabled, vapidPublicKey } from "@/lib/push";

/**
 * GET /api/push/config — whether push alerts are available, and the
 * public key a browser needs to subscribe.
 *
 * Served at runtime rather than baked in as a NEXT_PUBLIC_ variable on
 * purpose: the cPanel bundle is built on one machine and configured on
 * another, so anything read at build time would be wrong there.
 */
export function GET() {
  return NextResponse.json(
    { enabled: pushEnabled(), publicKey: vapidPublicKey() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
