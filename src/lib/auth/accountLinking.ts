import { db } from "@/lib/db";
import { sendEmail, googleLinkedEmail } from "@/lib/email";
import type { RefusalReason } from "@/lib/auth/loginErrors";

/**
 * Deciding what "Continue with Google" means when the address is already
 * known here.
 *
 * Auth.js offers one switch for this, `allowDangerousEmailAccountLinking`,
 * and its name is honest: turning it on links any OAuth identity to any
 * local account sharing an address, with no further test. That is a real
 * account-takeover route, and it is not theoretical —
 *
 *   An attacker registers here with *your* address and a password only
 *   they know. They never open the verification email; they cannot, it
 *   went to you. The account sits dormant. Later you press "Continue with
 *   Google", the addresses match, and you are dropped into the attacker's
 *   account. You use it for months. They still have the password.
 *
 * This is the pre-hijack attack described in Sudhodanan and Paverd's
 * "Pre-hijacking Attacks on Web User Accounts" (2022), and it is why the
 * rule below turns on *both* sides having proved the address:
 *
 *   - Google must say `email_verified` — it does not for every account,
 *     notably some Workspace identities where the domain admin created a
 *     mailbox alias.
 *   - The local account must already have `emailVerifiedAt` set, which
 *     only happens when somebody opened a link sent to that address.
 *
 * If either is missing, the sign-in is refused with an explanation rather
 * than linked. The person can still get in — with their password, or by
 * verifying the address from the email we already sent them — and both
 * routes prove what the automatic link could not.
 *
 * A successful link is written to the audit log and emailed to the account
 * holder, because a silent merge of two identities is precisely the event
 * somebody would want to be told about.
 */

export type LinkDecision =
  | { action: "allow" }
  | { action: "link"; userId: string }
  | { action: "refuse"; reason: RefusalReason };

export const GOOGLE_PROVIDER = "google";

interface GoogleIdentity {
  email: string | null | undefined;
  emailVerified: boolean;
  providerAccountId: string;
}

/**
 * What should happen for this Google identity, before anything is written.
 *
 * "allow" means Auth.js can carry on by itself: either the account is
 * already linked, or this is a brand-new person and the adapter will
 * create them. "link" means an existing local account passed both tests
 * and the Account row should be created for it. "refuse" stops the
 * sign-in.
 */
export async function decideLinking(identity: GoogleIdentity): Promise<LinkDecision> {
  if (!identity.email) return { action: "refuse", reason: "no_email" };

  const email = identity.email.toLowerCase();

  // Already linked: the ordinary case, every sign-in after the first.
  const linked = await db.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: GOOGLE_PROVIDER,
        providerAccountId: identity.providerAccountId,
      },
    },
    select: { user: { select: { id: true, status: true, anonymisedAt: true } } },
  });
  if (linked) {
    // A suspended or erased account must not be let back in by a route
    // that skips the password. The credentials provider checks the same
    // thing; both paths have to, or the weaker one becomes the way in.
    if (linked.user.status !== "ACTIVE" || linked.user.anonymisedAt) {
      return { action: "refuse", reason: "account_suspended" };
    }
    return { action: "allow" };
  }

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, status: true, anonymisedAt: true, emailVerifiedAt: true },
  });

  // Nobody here holds this address: a new account. The signIn callback
  // still has to find a record of consent before the adapter creates it.
  if (!existing) return { action: "allow" };

  if (existing.status !== "ACTIVE" || existing.anonymisedAt) {
    return { action: "refuse", reason: "account_suspended" };
  }

  // Both tests, in the order that gives the more useful message: if Google
  // itself will not vouch for the address, nothing about the local account
  // matters.
  if (!identity.emailVerified) {
    return { action: "refuse", reason: "google_email_unverified" };
  }
  if (!existing.emailVerifiedAt) {
    return { action: "refuse", reason: "local_email_unverified" };
  }

  return { action: "link", userId: existing.id };
}

/**
 * Creates the Account row that joins this Google identity to an existing
 * account, then records it where the account holder can see it.
 *
 * Written before Auth.js finishes the sign-in, because the lookup that
 * decides *which* user is signed in is `getUserByAccount` — so the row has
 * to exist by then. The unique index on (provider, providerAccountId) is
 * what makes a concurrent second attempt fail rather than duplicate.
 */
export async function linkGoogleAccount(params: {
  userId: string;
  providerAccountId: string;
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expires_at?: number | null;
    token_type?: string | null;
    scope?: string | null;
    id_token?: string | null;
  };
  ip?: string | null;
}): Promise<void> {
  // One transaction, because the audit row *is* the record that this
  // linking happened and was authorised. A link with no entry beside it
  // is the state nobody could later explain — so either both rows land or
  // neither does, and the sign-in fails loudly instead.
  await db.$transaction([
    db.account.create({
      data: {
        userId: params.userId,
        type: "oidc",
        provider: GOOGLE_PROVIDER,
        providerAccountId: params.providerAccountId,
        access_token: params.tokens.access_token ?? null,
        refresh_token: params.tokens.refresh_token ?? null,
        expires_at: params.tokens.expires_at ?? null,
        token_type: params.tokens.token_type ?? null,
        scope: params.tokens.scope ?? null,
        id_token: params.tokens.id_token ?? null,
      },
    }),
    db.auditLog.create({
      data: {
        actorId: params.userId,
        action: "auth.google.linked",
        targetType: "User",
        targetId: params.userId,
        metadata: { provider: GOOGLE_PROVIDER, linkedTo: params.providerAccountId },
        ip: params.ip ?? null,
      },
    }),
  ]);

  // Told, not just logged. Two identities becoming one is exactly the
  // change somebody needs to hear about while they can still object.
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { email: true, name: true },
  });
  if (user) {
    await sendEmail({ to: user.email, ...googleLinkedEmail(user.name) }).catch(() => {
      // A failed notification must not fail the sign-in. The audit row
      // above is the durable record either way.
    });
  }
}
