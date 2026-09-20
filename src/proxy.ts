import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

// Uses the same full, database-backed auth() as every page and server
// action — see the design note at the top of lib/auth/config.ts for why
// this isn't split into a separate "edge-safe" config. Proxy runs on the
// Node.js runtime by default in this Next.js version, so there's no
// Prisma/argon2 restriction to work around here.
//
// Passing a handler function to auth() means WE are responsible for
// reading req.auth and redirecting — the return value of a session
// callback is not auto-enforced the way an `authorized` callback would be
// for the bare `export default auth` form.
const STAFF_ROLES = new Set(["MODERATOR", "ADMIN"]);
const ADMIN_ONLY_PREFIXES = [
  "/dashboard/users",
  "/dashboard/settings",
  "/dashboard/audit-log",
  "/dashboard/categories",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/dashboard")) {
    const user = req.auth?.user;

    if (!user) {
      const loginUrl = new URL("/login", req.nextUrl);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (!STAFF_ROLES.has(user.role)) {
      // Not newsroom staff at all — no business in /dashboard/* whatsoever.
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }

    // Mandatory MFA for Admin accounts (security blueprint §Authentication
    // & sessions). An admin without MFA enrolled can reach only the
    // enrollment page itself — every other /dashboard/* route bounces
    // here until they finish setting it up.
    if (user.role === "ADMIN" && !user.mfaEnabled && pathname !== "/dashboard/mfa") {
      return NextResponse.redirect(new URL("/dashboard/mfa", req.nextUrl));
    }

    const requiresAdmin = ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
    if (requiresAdmin && user.role !== "ADMIN") {
      // Staff, but not admin-only-page staff — bounce to the dashboard
      // they *can* see rather than all the way out to the public site.
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
  }

  const res = NextResponse.next();
  applySecurityHeaders(res);
  return res;
});

function applySecurityHeaders(res: NextResponse) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  // A strict script-src (nonce-based, no unsafe-inline) is added once the
  // article renderer and any third-party embeds are finalized — see the
  // security blueprint's Network & browser-side defenses section.
}

// This matcher makes proxy run on nearly every route so security headers
// apply everywhere. Auth.js only hits the database (via the jwt callback
// in lib/auth/config.ts) when a request actually carries a session
// cookie, so anonymous traffic — the common case for public article pages
// — isn't paying a DB round trip here; only signed-in requests are. /media
// is excluded on top of that: it serves already-processed files (see
// app/media/[key]/route.ts), so a signed-in reader loading a page full of
// images would otherwise pay one DB-backed auth check per image for no
// reason. /api is excluded for a sharper reason — see the comment at the
// top of app/api/media/upload/route.ts on Proxy's request-body buffering
// cap.
export const config = {
  matcher: ["/dashboard/:path*", "/((?!api|media|_next/static|_next/image|favicon.ico).*)"],
};
