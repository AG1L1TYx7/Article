import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { exportPersonalData } from "@/lib/personalData";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request";

/**
 * GET /account/data — downloads everything the site holds about the
 * signed-in person as a JSON file. Cookie-authenticated and read-only, so
 * a plain link is enough; the browser saves it rather than showing it.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login?from=/account", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));
  }

  const data = await exportPersonalData(session.user.id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Access requests are themselves a security-relevant event.
  await recordAudit({
    actorId: session.user.id,
    action: "user.data.export",
    targetType: "User",
    targetId: session.user.id,
    ip: await getClientIp(),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-data-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
