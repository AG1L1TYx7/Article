import { auth } from "@/lib/auth/config";

type Role = "READER" | "MODERATOR" | "ADMIN";

const ROLE_RANK: Record<Role, number> = { READER: 0, MODERATOR: 1, ADMIN: 2 };

export class UnauthorizedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Server-side role gate. Call this at the top of every server action and
 * route handler that mutates privileged state — never rely on the client
 * having hidden a button. A role claim from the client is never trusted;
 * this reads the current session, which is itself re-validated against the
 * database on every request (see jwt callback in lib/auth/config.ts).
 */
export async function requireRole(minRole: Role) {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  if (ROLE_RANK[session.user.role] < ROLE_RANK[minRole]) throw new ForbiddenError();
  return session;
}

/**
 * Role gate plus a confirmed email address, for the actions the security
 * blueprint says an unverified account must not be able to take —
 * publishing and uploading media (commenting too, once it exists).
 *
 * emailConfirmed rides on the session token (named to avoid colliding
 * with next-auth's own emailVerified: Date | null), refreshed from the DB
 * on every request by the jwt callback in lib/auth/config.ts, so this
 * costs no extra query and can't go stale right after someone verifies.
 */
export async function requireVerifiedEmail(minRole: Role) {
  const session = await requireRole(minRole);
  if (!session.user.emailConfirmed) {
    throw new ForbiddenError("Verify your email address before doing that.");
  }
  return session;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  return session;
}

/**
 * Runs a server action body and converts an auth failure into a normal
 * `{ ok: false }` result instead of a thrown exception.
 *
 * Server actions that throw reject the promise on the client, which means
 * a form awaiting the result never reaches its own error handling — the
 * submit button sits in its pending state forever with nothing shown to
 * the user. Anything that isn't an auth error still throws, so genuine
 * faults keep surfacing through the error boundary rather than being
 * swallowed into a vague message.
 */
export async function guardAction<T>(
  run: () => Promise<T>
): Promise<T | { ok: false; error: string }> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { ok: false, error: "You need to be signed in to do that." };
    }
    if (err instanceof ForbiddenError) {
      return { ok: false, error: err.message };
    }
    // Anything else is a bug. Logged here, where the message and stack
    // are still intact, because what the client receives is a serialised
    // shadow of it that says nothing about the cause.
    console.error("[action failed]", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Permissions
//
// Roles became editable data (prisma/schema.prisma, lib/auth/permissions.ts),
// so what somebody may do is no longer answerable from their tier alone. New
// code should gate on a permission; requireRole above is kept because the
// tier still decides two things a permission cannot — whether /dashboard
// opens at all, and whether two-factor is compulsory — and because changing
// three dozen call sites in one go would be a poor trade for a feature whose
// whole point is that it can be adopted gradually.
//
// The permission list rides on the session token, refreshed from the database
// by the jwt callback on every request exactly as the role is, so a permission
// taken away takes effect on the very next request rather than whenever the
// token happens to expire. That is the same guarantee revoking a role has, and
// it is why these checks cost no extra query.

/** Whether this session holds a permission. No database call. */
export function sessionHas(
  session: { user?: { permissions?: string[] } } | null,
  permission: string
): boolean {
  return session?.user?.permissions?.includes(permission) ?? false;
}

/**
 * Server-side permission gate. Call it at the top of every server action and
 * route handler that mutates privileged state.
 *
 * Pass several to require any one of them — "article.edit.any" OR
 * "article.edit.own", say, where the caller then narrows by ownership.
 */
export async function requirePermission(...permissions: string[]) {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  const held = session.user.permissions ?? [];
  if (!permissions.some((p) => held.includes(p))) {
    throw new ForbiddenError("You do not have permission to do that.");
  }
  return session;
}

/**
 * Permission gate plus a confirmed email address, for the actions an
 * unverified account must not be able to take — publishing, uploading media,
 * commenting. See requireVerifiedEmail above for why emailConfirmed is free
 * to read here.
 */
export async function requireVerifiedPermission(...permissions: string[]) {
  const session = await requirePermission(...permissions);
  if (!session.user.emailConfirmed) {
    throw new ForbiddenError("Verify your email address before doing that.");
  }
  return session;
}
