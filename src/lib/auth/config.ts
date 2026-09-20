import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { isLocked, nextLockout } from "@/lib/auth/lockout";
import { loginSchema } from "@/lib/validation/auth";
import { loginLimiter } from "@/lib/rateLimit";
import { verifyTotp } from "@/lib/auth/mfa";
import { readCookie, TRUST_COOKIE, verifyTrustToken } from "@/lib/auth/trustedDevice";
import { recordAuthEvent } from "@/lib/audit";

// Design note: Auth.js does not support database-backed sessions with the
// Credentials provider (only OAuth providers can use the database session
// strategy — see https://authjs.dev/reference/nextjs#credentials). We use
// JWT sessions instead, and get the two properties we actually need —
// "log out everywhere" and "instantly kill a banned account" — via
// `sessionVersion` and `status`, both re-checked on every request in the
// jwt callback below.
//
// This one config is used everywhere — API routes, Server Components, and
// src/proxy.ts — with no edge/Node split. An earlier version of this file
// was split in two (a Prisma-free "edge-safe" config for proxy.ts, plus
// this one) on the assumption that Next.js middleware runs on the Edge
// runtime. That assumption is wrong for this Next.js version: per
// node_modules/next/dist/docs/.../proxy.md, "Proxy defaults to using the
// Node.js runtime" as of v16, and the `runtime` config option can't even
// be set to something else in a Proxy file. The split had a real bug as a
// result — proxy.ts decoded stale JWT claims without ever re-checking
// sessionVersion against the database, so a revoked session survived
// until it happened to hit a Node-runtime handler. Collapsing back to one
// config makes every request go through the real check below, including
// requests proxy.ts handles itself.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8h, sliding

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Required for any self-hosted deployment: Auth.js only auto-trusts the
  // incoming Host header on Vercel, and refuses to serve at all otherwise
  // ("UntrustedHost"). Dev mode hides this — it only surfaces under
  // `next start`, so auth was broken in production builds and fine
  // locally.
  //
  // Trusting Host/X-Forwarded-Host is safe here for the same reason
  // getClientIp trusts X-Forwarded-For: this app is meant to sit behind
  // Cloudflare, which overwrites both. Running it with nothing in front
  // would let a client spoof the host used to build callback URLs.
  trustHost: true,
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 60 * 60, // renew once per hour of activity
  },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
        totp: {},
      },
      async authorize(raw, request) {
        // Rate limited per IP (not per account) so an attacker can't dodge
        // the limit by spraying many different email addresses.
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const { success } = await loginLimiter.limit(ip);
        if (!success) return null;

        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, totp } = parsed.data;

        const user = await db.user.findUnique({ where: { email } });
        // Constant-shape response whether the account exists or not — avoid
        // leaking account existence, and always pay the hashing cost so
        // timing doesn't leak it either.
        const dummyHash =
          "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

        if (!user || !user.passwordHash) {
          await verifyPassword(dummyHash, password).catch(() => false);
          return null;
        }

        if (isLocked(user.lockedUntil)) {
          // Worth its own event: a burst of these is someone working
          // through a password list against one account, which the
          // lockout stops but nobody would otherwise ever see.
          await recordAuthEvent({ userId: user.id, action: "auth.login.locked", ip });
          return null;
        }
        if (user.status !== "ACTIVE") {
          await recordAuthEvent({
            userId: user.id,
            action: "auth.login.blocked",
            metadata: { status: user.status },
            ip,
          });
          return null;
        }

        const valid = await verifyPassword(user.passwordHash, password).catch(() => false);

        if (!valid) {
          const failedLoginCount = user.failedLoginCount + 1;
          const lockedUntil = nextLockout(failedLoginCount);
          await db.user.update({
            where: { id: user.id },
            data: { failedLoginCount, lockedUntil },
          });
          // Without this there is no record anywhere that anyone ever
          // tried and failed — so a credential-stuffing run against real
          // accounts is invisible until one of them succeeds.
          await recordAuthEvent({
            userId: user.id,
            action: "auth.login.failed",
            metadata: { failedLoginCount, lockedOut: lockedUntil !== null },
            ip,
          });
          return null;
        }

        // A device that presented a valid code within the last thirty days
        // and asked to be remembered skips the code. The password was still
        // required above; see lib/auth/trustedDevice.ts for what revokes it.
        const trusted =
          user.mfaEnabled &&
          verifyTrustToken(readCookie(request.headers.get("cookie"), TRUST_COOKIE), user);

        if (user.mfaEnabled && !trusted) {
          // Password is correct at this point — a wrong or missing TOTP
          // code doesn't count against the password-lockout counter above
          // (that's specifically for password guessing); the per-IP
          // loginLimiter still throttles repeated attempts either way.
          if (!totp || !user.mfaSecret || !verifyTotp(user.email, user.mfaSecret, totp)) {
            // The password was right and the second factor was not. That
            // is the signal that a password is already compromised, and
            // it is the single most urgent line in this log.
            await recordAuthEvent({
              userId: user.id,
              action: "auth.login.mfa_failed",
              metadata: { codeProvided: !!totp },
              ip,
            });
            return null;
          }
        }

        await db.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            lastLoginIp: ip,
          },
        });
        // Successes matter as much as failures: "when did this account
        // last sign in, and from where" is the first question asked about
        // a compromise.
        await recordAuthEvent({
          userId: user.id,
          action: "auth.login",
          metadata: { mfa: user.mfaEnabled },
          ip,
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionVersion: user.sessionVersion,
          mfaEnabled: user.mfaEnabled,
          emailConfirmed: user.emailVerifiedAt !== null,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.sessionVersion = user.sessionVersion;
        token.mfaEnabled = user.mfaEnabled;
        token.emailConfirmed = user.emailConfirmed;
        token.mustChangePassword = user.mustChangePassword;
        token.sub = user.id;
      }

      // Re-checked on every request — including requests proxy.ts itself
      // handles, now that it shares this same config — so a banned account
      // or a bumped sessionVersion invalidates this token immediately,
      // not just once the request reaches a page or server action. Also
      // keeps mfaEnabled current so proxy.ts can enforce mandatory MFA for
      // admins (see the redirect in proxy.ts) without its own DB call.
      if (token.sub) {
        const current = await db.user.findUnique({
          where: { id: token.sub },
          select: {
            role: true,
            status: true,
            sessionVersion: true,
            mfaEnabled: true,
            emailVerifiedAt: true,
            mustChangePassword: true,
          },
        });
        if (!current || current.status !== "ACTIVE" || current.sessionVersion !== token.sessionVersion) {
          return null;
        }
        token.role = current.role;
        token.mfaEnabled = current.mfaEnabled;
        token.emailConfirmed = current.emailVerifiedAt !== null;
        token.mustChangePassword = current.mustChangePassword;
      }

      return token;
    },
    async session({ session, token }) {
      if (token?.sub) {
        session.user.id = token.sub;
        session.user.role = token.role as "READER" | "MODERATOR" | "ADMIN";
        session.user.mfaEnabled = (token.mfaEnabled as boolean | undefined) ?? false;
        session.user.emailConfirmed = (token.emailConfirmed as boolean | undefined) ?? false;
        session.user.mustChangePassword = (token.mustChangePassword as boolean | undefined) ?? false;
      }
      return session;
    },
  },
});

/** Bumps sessionVersion so every outstanding JWT for this user stops validating. */
export async function revokeAllSessions(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}
