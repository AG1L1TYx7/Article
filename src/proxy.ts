import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { buildCsp, generateNonce } from "@/lib/csp";

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

// Where someone with a temporary password may still go. Everything else
// redirects to the change-password page until they have chosen their
// own — that is what makes the temporary password temporary.
const ALLOWED_WHILE_CHANGING_PASSWORD = ["/account/password", "/login", "/register", "/forgot-password", "/reset-password"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (
    req.auth?.user?.mustChangePassword &&
    // Page navigations only: the manifest, icons and feeds a page pulls in
    // must keep loading, or the change-password page itself renders broken.
    req.headers.get("accept")?.includes("text/html") &&
    !ALLOWED_WHILE_CHANGING_PASSWORD.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.redirect(new URL("/account/password?required=1", req.nextUrl));
  }

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

  // A fresh nonce per request. Next.js reads it back out of the CSP
  // header while rendering and puts it on its own script tags, so nothing
  // here has to thread it through the component tree.
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    mediaOrigin: mediaOrigin(),
    turnstile: !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  });

  // The request copy is what the renderer reads; the response copy is what
  // the browser enforces. Both are required.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  applySecurityHeaders(res);
  return res;
});

/**
 * The origin uploaded media is served from, when it is not this one.
 *
 * With S3 configured, Media.url points at the bucket or CDN, so img-src
 * has to allow it or every article image is blocked.
 */
function mediaOrigin(): string | undefined {
  const base = process.env.MEDIA_PUBLIC_BASE_URL || process.env.S3_ENDPOINT;
  if (!base) return undefined;
  try {
    return new URL(base).origin;
  } catch {
    return undefined;
  }
}

function applySecurityHeaders(res: NextResponse) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  // Superseded by frame-ancestors in the CSP above, kept for browsers
  // that predate it. The two agree: nothing may frame this site.
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
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
