import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { unreadNotificationCount } from "@/lib/notifications";

/**
 * The unread badge in the site header.
 *
 * A route handler rather than a server-rendered count on purpose: reading
 * the session in the shared layout would touch cookies and make every
 * page — including the homepage and article pages — dynamic, losing the
 * static rendering those pages are most worth having. See
 * components/HeaderAccountLinks.tsx for the same reasoning.
 *
 * Returns only the caller's own count, and 0 rather than an error when
 * signed out, since the header asks on every page load.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } });
  }

  const count = await unreadNotificationCount(session.user.id);
  return NextResponse.json(
    { count },
    // Per-viewer and changes constantly; a shared cache must never hold it.
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
