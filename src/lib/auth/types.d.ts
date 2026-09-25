import type { DefaultSession } from "next-auth";

type AppRole = "READER" | "MODERATOR" | "ADMIN";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
      mfaEnabled: boolean;
      /**
       * True only when the second factor is an authenticator app. An
       * emailed code sets mfaEnabled but not this, because src/proxy.ts
       * requires an app for administrators specifically.
       */
      mfaUsesApp: boolean;
      emailConfirmed: boolean;
      /** Signed in with a temporary password; must choose their own first. */
      mustChangePassword: boolean;
      /**
       * Every permission this account's role grants, from the catalogue in
       * lib/auth/permissions.ts. Re-read from the database on every request
       * by the jwt callback, so a permission withdrawn takes effect on the
       * very next one. Read it through sessionHas()/requirePermission()
       * rather than poking at the array.
       */
      permissions: string[];
    } & DefaultSession["user"];
  }

  /**
   * What a provider hands back, which is not the same thing as a session.
   *
   * These are optional because two kinds of provider now feed this type
   * and only one of them can fill it in:
   *
   *   - the Credentials providers build the whole thing in authorize(),
   *     because they have just read the row;
   *   - a Google sign-in arrives as the adapter's user — id, name, email,
   *     emailVerified, image — and knows nothing about roles or session
   *     versions, which belong to this application rather than to Google.
   *
   * The jwt callback in lib/auth/config.ts branches on exactly that and
   * reads the missing fields from the database, so by the time anything
   * renders, Session["user"] above has them all and they are not optional
   * there. Declaring them required here would only mean lying to the
   * compiler about the OAuth path.
   */
  interface User {
    role?: AppRole;
    sessionVersion?: number;
    mfaEnabled?: boolean;
    mfaUsesApp?: boolean;
    emailConfirmed?: boolean;
    mustChangePassword?: boolean;
    permissions?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    sessionVersion?: number;
    mfaEnabled?: boolean;
    mfaUsesApp?: boolean;
    emailConfirmed?: boolean;
    mustChangePassword?: boolean;
  }
}
