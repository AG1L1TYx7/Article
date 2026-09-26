import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { isLocked, nextLockout } from "@/lib/auth/lockout";
import { loginSchema, mfaCodeSchema } from "@/lib/validation/auth";
import { loginLimiter, mfaCheckLimiter } from "@/lib/rateLimit";
import { verifyTotp } from "@/lib/auth/mfa";
import { consumeRecoveryCode, looksLikeRecoveryCode, parseStoredCodes } from "@/lib/auth/recoveryCodes";
import { readCookie, TRUST_COOKIE, verifyTrustToken } from "@/lib/auth/trustedDevice";
import { recordAuthEvent } from "@/lib/audit";
import { PrismaAdapter } from "@/lib/auth/adapter";
import { decideLinking, linkGoogleAccount, GOOGLE_PROVIDER } from "@/lib/auth/accountLinking";
import {
  CONNECT_COOKIE,
  CONSENT_COOKIE,
  issueStepUpToken,
  readConnectToken,
  readConsentToken,
  readStepUpToken,
} from "@/lib/auth/oauthFlow";
import { importGoogleAvatar } from "@/lib/auth/avatar";
import { issueEmailOtp, verifyEmailOtp } from "@/lib/auth/emailOtp";

/**
 * Google sign-in is configured, or it is not.
 *
 * With no client id and secret the provider is left out of the array
 * entirely rather than registered and left to fail at the redirect — and
 * `googleEnabled` is what the login and registration pages read to decide
 * whether to offer the button at all. A button that leads to an Auth.js
 * error page is worse than no button.
 */
export const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** The shape the Credentials providers return, and the JWT is built from. */
interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "READER" | "MODERATOR" | "ADMIN";
  sessionVersion: number;
  mfaEnabled: boolean;
  mfaUsesApp: boolean;
  emailConfirmed: boolean;
  mustChangePassword: boolean;
}

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

/**
 * Client IP from the request Auth.js hands a provider.
 *
 * Same rule as lib/request.ts getClientIp(): X-Forwarded-For is trusted
 * because this app is meant to sit behind Cloudflare, which overwrites it.
 * Taken from the Request here rather than next/headers because a provider's
 * authorize() is given the request directly.
 */
function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * The same, for the callbacks — which Auth.js does not hand a Request.
 *
 * next/headers works because a callback runs inside the route handler's
 * async context. If that ever stops being true the catch keeps a sign-in
 * working with a degraded rate-limit key rather than failing outright.
 */
async function currentIp(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * One cookie, read from the callback context.
 *
 * Fails closed on purpose. Both callers treat "no value" as the safe
 * answer: no consent means no account is created, and no trusted-device
 * cookie means the second factor is asked for. An unreadable cookie jar
 * therefore inconveniences somebody; it never waves them through.
 */
async function readCookieValue(name: string): Promise<string | undefined> {
  try {
    const jar = await cookies();
    return jar.get(name)?.value;
  } catch {
    return undefined;
  }
}

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
  pages: { signIn: "/login", error: "/login" },
  // The adapter is what persists an OAuth identity: the User row on first
  // Google sign-in, and the Account row joining the two. It is NOT the
  // stock @auth/prisma-adapter — see lib/auth/adapter.ts for why that one
  // cannot work against this schema.
  //
  // Sessions stay JWT regardless. Auth.js only offers database sessions to
  // OAuth providers, never to Credentials, so with both in play the
  // strategy has to be one both can use — and JWT is the one this
  // application already gets its guarantees from (see the note above).
  adapter: PrismaAdapter(),
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 60 * 60, // renew once per hour of activity
  },
  providers: [
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            // Left at its default of false, and it must stay that way.
            // Turning it on links any Google identity to any local account
            // with a matching address, with no test at all — the
            // pre-hijack hole described in lib/auth/accountLinking.ts,
            // which implements the conditional linking this app does
            // instead, inside the signIn callback below.
            allowDangerousEmailAccountLinking: false,
            authorization: {
              params: {
                // Nothing beyond identity is wanted: no Drive, no Gmail,
                // no contacts. Asking for less is both a smaller consent
                // screen and less data this site could ever be accused of
                // holding.
                scope: "openid email profile",
                // Shows the account chooser every time rather than
                // silently reusing whichever Google account the browser
                // happens to be signed into — on a shared computer the
                // silent path signs the wrong person in.
                prompt: "select_account",
                // No refresh token: nothing here acts on the person's
                // behalf at Google after sign-in, so there is nothing to
                // refresh, and a long-lived credential we do not need is
                // a long-lived credential we could still leak.
                access_type: "online",
              },
            },
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email,
                // The one place this decision is made. Google reports
                // `email_verified: false` for some Workspace identities,
                // and treating those as verified is what the whole
                // linking policy exists to prevent.
                emailVerified: profile.email_verified ? new Date() : null,
                image: profile.picture,
              };
            },
          }),
        ]
      : []),

    // Finishing a Google sign-in for an account that has two-factor on.
    //
    // The Google leg deliberately ends without a session (see the signIn
    // callback); it hands back a signed token naming the account. This
    // provider is what turns that token plus a correct code into a
    // session, so "Sign in with Google" can never be a way around the
    // second factor — which for admins is mandatory and enforced in
    // proxy.ts.
    Credentials({
      id: "mfa-continue",
      name: "Two-factor",
      credentials: { token: {}, totp: {} },
      async authorize(raw, request) {
        const ip = clientIp(request);
        const { success } = await mfaCheckLimiter.limit(ip);
        if (!success) return null;

        const pending = readStepUpToken(
          typeof raw?.token === "string" ? raw.token : undefined
        );
        if (!pending) return null;

        const code = mfaCodeSchema.safeParse(raw?.totp);
        if (!code.success) return null;

        const user = await db.user.findUnique({
          where: { id: pending.userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            anonymisedAt: true,
            sessionVersion: true,
            mfaEnabled: true,
            mfaMethod: true,
            mfaSecret: true,
            emailVerifiedAt: true,
            mustChangePassword: true,
          },
        });

        // Every condition that made the token worth issuing is checked
        // again here, because minutes have passed and any of them may
        // have changed. A bumped sessionVersion in particular means "log
        // out everywhere" happened in between, and this token died with
        // the sessions.
        if (!user || user.status !== "ACTIVE" || user.anonymisedAt) return null;
        if (user.sessionVersion !== pending.sessionVersion) return null;
        if (!user.mfaEnabled) return null;

        const accepted =
          user.mfaMethod === "EMAIL"
            ? (await verifyEmailOtp(user.id, code.data)) === "ok"
            : !!user.mfaSecret && verifyTotp(user.email, user.mfaSecret, code.data);

        if (!accepted) {
          // Google said who they are and the second factor did not: the
          // same signal as a correct password with a failed code, and
          // just as worth reading in the log.
          await recordAuthEvent({
            userId: user.id,
            action: "auth.login.mfa_failed",
            metadata: { provider: GOOGLE_PROVIDER },
            ip,
          });
          return null;
        }

        await db.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip },
        });
        await recordAuthEvent({
          userId: user.id,
          action: "auth.login",
          metadata: { provider: GOOGLE_PROVIDER, mfa: true },
          ip,
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionVersion: user.sessionVersion,
          mfaEnabled: user.mfaEnabled,
          mfaUsesApp: user.mfaEnabled && user.mfaMethod === "TOTP",
          emailConfirmed: user.emailVerifiedAt !== null,
          mustChangePassword: user.mustChangePassword,
        } satisfies SessionUser;
      },
    }),

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
          // Password is correct at this point — a wrong or missing second
          // factor doesn't count against the password-lockout counter
          // above (that's specifically for password guessing); the per-IP
          // loginLimiter still throttles repeated attempts either way.
          //
          // Three ways to satisfy the second factor, and the account
          // decides which of the first two applies. An emailed code was
          // already sent by checkMfaRequired() in the login action, which
          // runs only after this same password check passes — so nothing
          // here can be used to make us send mail.
          let secondFactorOk = false;
          if (totp) {
            if (user.mfaMethod === "EMAIL") {
              secondFactorOk = (await verifyEmailOtp(user.id, totp)) === "ok";
            } else if (user.mfaSecret && /^\d{6}$/.test(totp)) {
              secondFactorOk = verifyTotp(user.email, user.mfaSecret, totp);
            }
            // A recovery code (lib/auth/recoveryCodes.ts) is the way back
            // in when the authenticator or the mailbox is gone, so it is
            // tried for either method once the normal one has not matched.
            // Eight letters and digits, so it cannot be mistaken for a
            // six-digit code. Consumed on success, never replayable.
            if (!secondFactorOk && looksLikeRecoveryCode(totp)) {
              const { matched, remaining } = consumeRecoveryCode(parseStoredCodes(user.mfaRecoveryCodes), totp);
              if (matched) {
                secondFactorOk = true;
                await db.user.update({
                  where: { id: user.id },
                  data: { mfaRecoveryCodes: JSON.stringify(remaining) },
                });
                await recordAuthEvent({
                  userId: user.id,
                  action: "auth.mfa.recovery_used",
                  metadata: { remaining: remaining.length },
                  ip,
                });
              }
            }
          }

          if (!secondFactorOk) {
            // The password was right and the second factor was not. That
            // is the signal that a password is already compromised, and
            // it is the single most urgent line in this log.
            await recordAuthEvent({
              userId: user.id,
              action: "auth.login.mfa_failed",
              metadata: { codeProvided: !!totp, method: user.mfaMethod ?? "TOTP" },
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
          mfaUsesApp: user.mfaEnabled && user.mfaMethod === "TOTP",
          emailConfirmed: user.emailVerifiedAt !== null,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * The gate for Google sign-ins. Everything this application decides
     * about an external identity, it decides here.
     *
     * Runs before Auth.js creates or looks up anything (@auth/core calls
     * handleAuthorized ahead of handleLoginOrRegister), which is what lets
     * the linking below be conditional rather than the all-or-nothing
     * `allowDangerousEmailAccountLinking` switch.
     *
     * Returning a string redirects and issues NO session. That is the
     * mechanism behind both refusals and the second-factor step: the
     * Google leg can end without anybody being signed in.
     *
     * The credentials providers return true unmodified — their own
     * authorize() has already done every check, and returning null there
     * is how they refuse.
     */
    async signIn({ user, account, profile }) {
      if (!account || account.provider !== GOOGLE_PROVIDER) return true;

      const ip = await currentIp();
      const { success } = await loginLimiter.limit(ip);
      if (!success) return "/login?error=rate_limited";

      // "Connect Google" from the account page, by somebody already
      // signed in. Handled before the email-matching rules below, which
      // do not apply: the account is not in question here, only which
      // Google identity should reach it. See lib/auth/oauthFlow.ts.
      const connect = readConnectToken(await readCookieValue(CONNECT_COOKIE));
      if (connect) {
        const owner = await db.user.findUnique({
          where: { id: connect.userId },
          select: { id: true, status: true, anonymisedAt: true, sessionVersion: true },
        });
        if (
          !owner ||
          owner.status !== "ACTIVE" ||
          owner.anonymisedAt ||
          owner.sessionVersion !== connect.sessionVersion
        ) {
          return "/account/settings?google=failed";
        }

        const alreadyLinked = await db.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: GOOGLE_PROVIDER,
              providerAccountId: account.providerAccountId,
            },
          },
          select: { userId: true },
        });
        if (alreadyLinked) {
          // Connecting it here would either be a no-op or would quietly
          // move somebody else's sign-in method onto this account.
          return alreadyLinked.userId === owner.id
            ? "/account/settings?google=connected"
            : "/account/settings?google=taken";
        }

        try {
          await linkGoogleAccount({
            userId: owner.id,
            providerAccountId: account.providerAccountId,
            tokens: account,
            ip,
          });
        } catch {
          return "/account/settings?google=failed";
        }
        return "/account/settings?google=connected";
      }

      const decision = await decideLinking({
        email: profile?.email ?? user?.email,
        emailVerified: profile?.email_verified === true,
        providerAccountId: account.providerAccountId,
      });

      if (decision.action === "refuse") {
        return `/login?error=${decision.reason}`;
      }

      // Which account this sign-in is about to land in.
      //
      // Resolved through the provider link, never by looking the email
      // address up again. The address is how the link was *decided*; the
      // Account row is what Auth.js will actually follow a moment from now
      // (getUserByAccount), and the two can disagree — an address that
      // changes here later would silently stop matching, and this is the
      // lookup that decides whether a second factor is demanded.
      let userId: string | null = null;

      if (decision.action === "link") {
        // Both sides proved the address. Create the join row now, so the
        // getUserByAccount lookup that runs next finds this account and
        // signs them into it instead of trying to create a second one.
        try {
          await linkGoogleAccount({
            userId: decision.userId,
            providerAccountId: account.providerAccountId,
            tokens: account,
            ip,
          });
        } catch {
          // Almost certainly the unique index firing because two tabs
          // raced. Sending them back to try again is safe and honest; a
          // partial link is not possible, the write is a transaction.
          return "/login?error=link_failed";
        }
        userId = decision.userId;
      } else {
        const linked = await db.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: GOOGLE_PROVIDER,
              providerAccountId: account.providerAccountId,
            },
          },
          select: { userId: true },
        });
        userId = linked?.userId ?? null;
      }

      // No account behind this identity yet: the adapter is about to
      // create one. It may only do that with a record of consent, taken
      // before they left for Google.
      if (!userId) {
        const consented = readConsentToken(await readCookieValue(CONSENT_COOKIE));
        if (!consented) return "/register?error=consent_required";
        return true; // brand new: no second factor can exist yet
      }

      // Existing account, now reachable through Google. If it carries a
      // second factor, Google alone is not enough — hand back a signed
      // token and let /login/mfa and the "mfa-continue" provider finish
      // the job. No session is issued by returning this redirect.
      const target = await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          sessionVersion: true,
          mfaEnabled: true,
          mfaMethod: true,
          mfaSecret: true,
        },
      });
      if (target?.mfaEnabled) {
        const trusted = verifyTrustToken(await readCookieValue(TRUST_COOKIE), target);
        if (!trusted) {
          // An emailed code has to be sent before it can be asked for.
          // Only here, once Google has already identified them — never on
          // a request somebody could make without passing a first factor.
          if (target.mfaMethod === "EMAIL") {
            await issueEmailOtp(target).catch(() => {
              // A failed send leaves them at the code page with nothing to
              // type, which the Resend button there is for. Better than
              // dropping them back to /login with no explanation.
            });
          }
          const method = target.mfaMethod === "EMAIL" ? "email" : "app";
          return `/login/mfa?t=${encodeURIComponent(issueStepUpToken(target))}&m=${method}`;
        }
      }

      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;

        // The credentials providers build the whole SessionUser above, so
        // its fields are already here. An OAuth sign-in arrives as the
        // adapter's user — id, name, email and nothing else this token
        // needs — so the rest is read from the row.
        //
        // sessionVersion matters most: the check further down kills any
        // token whose version disagrees with the database, and an
        // undefined one disagrees with every account. Without this, every
        // Google sign-in would produce a session that died on its first
        // request.
        if (typeof (user as Partial<SessionUser>).sessionVersion === "number") {
          const known = user as SessionUser;
          token.role = known.role;
          token.sessionVersion = known.sessionVersion;
          token.mfaEnabled = known.mfaEnabled;
          token.mfaUsesApp = known.mfaUsesApp ?? false;
          token.emailConfirmed = known.emailConfirmed;
          token.mustChangePassword = known.mustChangePassword;
        } else {
          const fresh = await db.user.findUnique({
            where: { id: user.id! },
            select: {
              role: true,
              sessionVersion: true,
              mfaEnabled: true,
              mfaMethod: true,
              emailVerifiedAt: true,
              mustChangePassword: true,
            },
          });
          if (!fresh) return null;
          token.role = fresh.role;
          token.sessionVersion = fresh.sessionVersion;
          token.mfaEnabled = fresh.mfaEnabled;
          token.mfaUsesApp = fresh.mfaEnabled && fresh.mfaMethod === "TOTP";
          token.emailConfirmed = fresh.emailVerifiedAt !== null;
          token.mustChangePassword = fresh.mustChangePassword;
        }
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
            name: true,
            role: true,
            status: true,
            sessionVersion: true,
            mfaEnabled: true,
            mfaMethod: true,
            emailVerifiedAt: true,
            mustChangePassword: true,
            // Pulled in on the same query that already runs per request,
            // so permission checks cost nothing extra — and so a
            // permission taken away stops applying on the next request,
            // the same guarantee sessionVersion gives for sessions.
            userRole: { select: { permissions: { select: { permission: true } } } },
          },
        });
        if (!current || current.status !== "ACTIVE" || current.sessionVersion !== token.sessionVersion) {
          return null;
        }
        // The row is already being read on every request; taking the name
        // from it means a changed name reaches the header at once rather
        // than at the next sign-in.
        token.name = current.name;
        token.role = current.role;
        token.mfaEnabled = current.mfaEnabled;
        token.mfaUsesApp = current.mfaEnabled && current.mfaMethod === "TOTP";
        token.emailConfirmed = current.emailVerifiedAt !== null;
        token.mustChangePassword = current.mustChangePassword;
        token.permissions = current.userRole?.permissions.map((p) => p.permission) ?? [];
      }

      return token;
    },
    async session({ session, token }) {
      if (token?.sub) {
        session.user.id = token.sub;
        session.user.role = token.role as "READER" | "MODERATOR" | "ADMIN";
        session.user.mfaEnabled = (token.mfaEnabled as boolean | undefined) ?? false;
        session.user.mfaUsesApp = (token.mfaUsesApp as boolean | undefined) ?? false;
        session.user.emailConfirmed = (token.emailConfirmed as boolean | undefined) ?? false;
        session.user.mustChangePassword = (token.mustChangePassword as boolean | undefined) ?? false;
        session.user.permissions = (token.permissions as string[] | undefined) ?? [];
      }
      return session;
    },
  },

  events: {
    /**
     * After a Google sign-in has actually succeeded.
     *
     * Here rather than in the signIn callback because this is the only
     * point at which the sign-in is known to have completed — the callback
     * can still end in a redirect with no session, and an audit row saying
     * somebody signed in when they did not is worse than none.
     *
     * The credentials providers write their own auth.login rows inside
     * authorize(), where they have the detail; this covers the OAuth path
     * only. Accounts that went through the second factor are logged by the
     * "mfa-continue" provider, so they are skipped here to avoid two rows
     * for one sign-in.
     */
    async signIn({ user, account, profile, isNewUser }) {
      if (!account || account.provider !== GOOGLE_PROVIDER || !user.id) return;

      const ip = await currentIp();
      await db.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIp: ip } })
        .catch(() => {});
      await recordAuthEvent({
        userId: user.id,
        action: "auth.login",
        metadata: { provider: GOOGLE_PROVIDER, newAccount: isNewUser === true },
        ip,
      });

      // Deliberately not awaited into the critical path beyond this: the
      // picture is fetched from Google and re-hosted (see lib/auth/avatar.ts
      // for why it is not simply linked), and a slow or missing image must
      // not hold up a sign-in. It only ever runs for an account with no
      // avatar yet, so a second sign-in does not overwrite a chosen one.
      const picture = (profile as { picture?: string } | undefined)?.picture;
      await importGoogleAvatar(user.id, picture).catch(() => {});
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
