import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";
import { db } from "@/lib/db";
import { uniqueHandle } from "@/lib/auth/handle";
import { defaultRoleId } from "@/lib/auth/roleService";

/**
 * A Prisma adapter written for *this* schema, rather than the stock
 * `@auth/prisma-adapter`.
 *
 * The published adapter cannot be used here, and would fail at the first
 * Google sign-up rather than in some subtle way later:
 *
 *   - it writes `emailVerified` and `image`; this schema has
 *     `emailVerifiedAt` and `avatarUrl`, deliberately, because those names
 *     say what they hold. Adding duplicate columns to satisfy a library
 *     would give every account two places to record the same fact, and
 *     nothing to keep them in step.
 *   - `User.handle` is required and unique with no default. Auth.js knows
 *     nothing about handles, so a user created by the stock adapter could
 *     not be inserted at all. One is derived here — see lib/auth/handle.ts.
 *   - `User.name` is non-null. Google always supplies one, but a provider
 *     is not obliged to, so a fallback is applied rather than trusted.
 *
 * Everything the interface asks for is implemented, including the session
 * and verification-token methods. Those are unused today — the session
 * strategy is JWT (see the note in lib/auth/config.ts) and e-mail links go
 * through this project's own `lib/auth/tokens.ts` — but a half-implemented
 * adapter is a trap for whoever changes the strategy later, and the tables
 * already exist.
 *
 * `createUser` is only ever reached after the `signIn` callback in
 * lib/auth/config.ts has returned true, and that callback refuses a new
 * account unless consent to the terms was recorded first. That is why
 * `termsAcceptedAt` can be set here with confidence; the two must be read
 * together.
 */

/** The application's User row, in the shape Auth.js expects to receive. */
type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
};

function toAdapterUser(user: UserRow): AdapterUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    // Auth.js's `emailVerified` is a Date-or-null, which is exactly what
    // emailVerifiedAt holds; only the name differs.
    emailVerified: user.emailVerifiedAt,
    image: user.avatarUrl,
  };
}

const USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  emailVerifiedAt: true,
  avatarUrl: true,
} as const;

export function PrismaAdapter(): Adapter {
  return {
    async createUser(user) {
      // Auth.js types `email` as string, but a provider that returns no
      // address would reach here with undefined at runtime. An account
      // with no email cannot verify, cannot reset, cannot be found by its
      // owner, and cannot receive a legal notice — refuse it.
      if (!user.email) throw new Error("Cannot create an account without an email address");

      const created = await db.user.create({
        data: {
          email: user.email,
          name: user.name?.trim() || user.email.split("@")[0]!,
          handle: await uniqueHandle(user.name),
          // Only what the provider actually asserted. Google sets this
          // when `email_verified` was true in the ID token — see
          // profile() in lib/auth/config.ts, which is the only place that
          // decision is made.
          emailVerifiedAt: user.emailVerified ?? null,
          // Never the provider's URL: lib/auth/avatar.ts re-hosts the
          // picture after sign-in, so no reader's browser ever contacts
          // Google. A URL arriving here would be a bug elsewhere.
          avatarUrl: null,
          // See the note at the top of this file: the signIn callback has
          // already refused this sign-up if consent was not given.
          termsAcceptedAt: new Date(),
          // Same reason as the registration form: an account with no role
          // holds no permissions at all.
          roleId: await defaultRoleId(),
        },
        select: USER_FIELDS,
      });
      return toAdapterUser(created);
    },

    async getUser(id) {
      const user = await db.user.findUnique({ where: { id }, select: USER_FIELDS });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByEmail(email) {
      const user = await db.user.findUnique({ where: { email }, select: USER_FIELDS });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await db.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        select: { user: { select: USER_FIELDS } },
      });
      return account ? toAdapterUser(account.user) : null;
    },

    async updateUser(user) {
      if (!user.id) throw new Error("updateUser called without an id");
      // Deliberately narrow. Auth.js would otherwise write the provider's
      // name and picture over the account's own on every sign-in, quietly
      // undoing a rename the person made here. Only the verification
      // timestamp is accepted, and only to set it — never to clear it.
      const data: { emailVerifiedAt?: Date } = {};
      if (user.emailVerified) data.emailVerifiedAt = user.emailVerified;

      const updated = Object.keys(data).length
        ? await db.user.update({ where: { id: user.id }, data, select: USER_FIELDS })
        : await db.user.findUniqueOrThrow({ where: { id: user.id }, select: USER_FIELDS });
      return toAdapterUser(updated);
    },

    async deleteUser(id) {
      // Not reachable through the interface: erasure goes through
      // lib/accountDeletion.ts, which anonymises rather than deletes so
      // that comments and audit entries keep their foreign keys. A hard
      // delete here would cascade those away and break the audit trail,
      // so it is refused rather than silently doing the wrong thing.
      throw new Error(
        `Refusing to hard-delete user ${id}: use anonymiseAccount() in lib/accountDeletion.ts`
      );
    },

    async linkAccount(account) {
      await db.account.create({ data: accountData(account) });
      return account;
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await db.account.delete({
        where: { provider_providerAccountId: { provider, providerAccountId } },
      });
    },

    // ---- Sessions -------------------------------------------------------
    // Unused while the strategy is JWT, and correct if it ever is not.

    async createSession(session): Promise<AdapterSession> {
      return db.session.create({ data: session });
    },

    async getSessionAndUser(sessionToken) {
      const session = await db.session.findUnique({
        where: { sessionToken },
        select: {
          id: true,
          sessionToken: true,
          userId: true,
          expires: true,
          user: { select: USER_FIELDS },
        },
      });
      if (!session) return null;
      const { user, ...rest } = session;
      return { session: rest, user: toAdapterUser(user) };
    },

    async updateSession(session) {
      return db.session.update({ where: { sessionToken: session.sessionToken }, data: session });
    },

    async deleteSession(sessionToken) {
      // A session that has already expired and been swept is a normal
      // race, not an error worth failing a sign-out over.
      await db.session.deleteMany({ where: { sessionToken } });
    },

    // ---- Verification tokens -------------------------------------------
    // Only the Email provider uses these. This project sends its own links
    // through lib/auth/tokens.ts; implemented so the adapter is whole.

    async createVerificationToken(token) {
      return db.verificationToken.create({ data: token });
    },

    async useVerificationToken({ identifier, token }) {
      try {
        return await db.verificationToken.delete({
          where: { identifier_token: { identifier, token } },
        });
      } catch {
        // Already used, or never existed. Both mean "not valid".
        return null;
      }
    },
  };
}

/**
 * The provider's own fields, mapped onto the Account row.
 *
 * Listed explicitly rather than spread: an OAuth response carries keys
 * Prisma has no column for, and `data: { ...account }` would throw on
 * whichever one Google adds next.
 */
function accountData(account: AdapterAccount) {
  return {
    userId: account.userId,
    type: account.type,
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    refresh_token: account.refresh_token ?? null,
    access_token: account.access_token ?? null,
    expires_at: typeof account.expires_at === "number" ? account.expires_at : null,
    token_type: account.token_type ?? null,
    scope: account.scope ?? null,
    id_token: account.id_token ?? null,
    session_state:
      typeof account.session_state === "string" ? account.session_state : null,
  };
}

export { accountData };
