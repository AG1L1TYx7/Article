import { db } from "@/lib/db";
import {
  CRITICAL_PERMISSIONS,
  isKnownPermission,
  tierAllows,
  tierRank,
  type Tier,
} from "@/lib/auth/permissions";

/**
 * Every write that touches a role, and the rules that stop an
 * administrator locking the newsroom out of its own site.
 *
 * The rules matter more than the writes. A permission system that lets you
 * remove the last person who can manage people is not a permission system,
 * it is a trapdoor — and the recovery from it is a database console, which
 * on shared hosting may not exist. So each of these is refused with a
 * sentence explaining what to do instead, rather than allowed and
 * regretted:
 *
 *   - a system role cannot be deleted, and its key cannot change;
 *   - the administrator role cannot lose the permissions that administer
 *     the site;
 *   - a role still held by somebody cannot be deleted;
 *   - nobody can change their own role, so no one-click self-demotion and
 *     no privilege escalation by editing yourself;
 *   - the last account that can manage people cannot be moved off it.
 *
 * The same rules are enforced here rather than in the pages, because there
 * are two ways to reach most of them — editing the role, or moving the
 * person — and a rule written once cannot be half-applied.
 */

export class RoleRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleRuleError";
  }
}

/** Which permissions may be saved against a role at this tier. */
export function validatePermissions(tier: Tier, requested: string[]): string[] {
  const unique = [...new Set(requested)];

  const unknown = unique.filter((key) => !isKnownPermission(key));
  if (unknown.length) {
    // Nothing checks an unknown key, so storing it would promise an
    // ability that does not exist.
    throw new RoleRuleError(`Unknown permission: ${unknown.join(", ")}`);
  }

  const tooHigh = unique.filter((key) => !tierAllows(tier, key));
  if (tooHigh.length) {
    throw new RoleRuleError(
      `This role's access level is too low for: ${tooHigh.join(", ")}. Raise the access level, or leave those unticked.`
    );
  }

  return unique.sort();
}

/**
 * The administrator role keeps the keys to the building.
 *
 * Without this, one careless save on the protected role removes
 * "role.manage" from the only role that has it, and from that moment
 * nobody can put it back through the application at all.
 */
function assertProtectedRoleKeepsControl(isProtected: boolean, permissions: string[]) {
  if (!isProtected) return;
  const missing = CRITICAL_PERMISSIONS.filter((key) => !permissions.includes(key));
  if (missing.length) {
    throw new RoleRuleError(
      `The administrator role has to keep ${missing.join(" and ")} — without it nobody could administer the site.`
    );
  }
}

export async function createRole(input: {
  key: string;
  name: string;
  description: string | null;
  tier: Tier;
  permissions: string[];
}) {
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(key)) {
    throw new RoleRuleError(
      "The identifier must be 3–40 characters of lowercase letters, numbers and hyphens."
    );
  }
  if (!input.name.trim()) throw new RoleRuleError("Give the role a name.");

  const clash = await db.userRole.findUnique({ where: { key }, select: { id: true } });
  if (clash) throw new RoleRuleError("A role with that identifier already exists.");

  const permissions = validatePermissions(input.tier, input.permissions);

  return db.userRole.create({
    data: {
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      tier: input.tier,
      isSystem: false,
      isProtected: false,
      permissions: { create: permissions.map((permission) => ({ permission })) },
    },
    select: { id: true, key: true, name: true },
  });
}

export async function updateRole(
  roleId: string,
  input: { name: string; description: string | null; tier: Tier; permissions: string[] }
) {
  const role = await db.userRole.findUnique({
    where: { id: roleId },
    select: { id: true, key: true, tier: true, isSystem: true, isProtected: true },
  });
  if (!role) throw new RoleRuleError("That role no longer exists.");
  if (!input.name.trim()) throw new RoleRuleError("Give the role a name.");

  // A system role's tier is what the rest of the application assumes about
  // it — "admin" meaning ADMIN is wired into mandatory two-factor and into
  // the seed. Its permissions stay editable; its tier does not.
  const tier = role.isSystem ? role.tier : input.tier;
  if (role.isSystem && input.tier !== role.tier) {
    throw new RoleRuleError(
      "A built-in role's access level cannot change. Create a new role if you need a different one."
    );
  }

  const permissions = validatePermissions(tier, input.permissions);
  assertProtectedRoleKeepsControl(role.isProtected, permissions);

  // Replace rather than diff: the set is small, and one delete-then-insert
  // inside a transaction cannot leave a half-applied permission set behind.
  //
  // The updateMany is not optional. `User.role` is a denormalised copy of
  // this tier, and changing the tier here without rewriting it leaves every
  // holder authorised by two different answers at once: permissions refresh
  // on their next request (the jwt callback re-reads them), the tier does
  // not. Both directions are dangerous.
  //
  //   Raising a role to ADMIN gives its holders user.manage and role.manage
  //   immediately, while User.role still reads MODERATOR — so proxy.ts's
  //   "administrators must use an authenticator app" check never fires, and
  //   the account page's refusal to put an administrator on emailed codes
  //   never fires either. Full administrative permissions, no mandatory
  //   second factor.
  //
  //   Lowering a role from ADMIN clamps its permissions but leaves
  //   User.role = "ADMIN", so every requireRole("ADMIN") gate and every
  //   ADMIN_ONLY_PREFIXES route still admits them. The demotion silently
  //   does not happen where it matters most.
  //
  // sessionVersion is bumped for the same reason assignRole bumps it: the
  // change has to reach people who are already signed in, on their very
  // next request.
  const tierChanged = tier !== role.tier;

  await db.$transaction([
    db.userRole.update({
      where: { id: roleId },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        tier,
      },
    }),
    db.rolePermission.deleteMany({ where: { roleId } }),
    db.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId, permission })),
    }),
    ...(tierChanged
      ? [db.user.updateMany({ where: { roleId }, data: { role: tier, sessionVersion: { increment: 1 } } })]
      : []),
  ]);
}

export async function deleteRole(roleId: string) {
  const role = await db.userRole.findUnique({
    where: { id: roleId },
    select: { id: true, name: true, isSystem: true, _count: { select: { users: true } } },
  });
  if (!role) return;

  if (role.isSystem) {
    throw new RoleRuleError("Built-in roles cannot be deleted.");
  }
  if (role._count.users > 0) {
    // Deleting would set those accounts' roleId to null (the relation is
    // onDelete: SetNull), leaving them with no permissions at all and no
    // obvious explanation. Make the reassignment explicit instead.
    throw new RoleRuleError(
      `${role._count.users} ${role._count.users === 1 ? "person holds" : "people hold"} this role. Move them to another role first.`
    );
  }

  await db.userRole.delete({ where: { id: roleId } });
}

/**
 * Moves an account onto a role — the one place `User.roleId` and the
 * denormalised `User.role` tier are written, and always together, in one
 * transaction. See the note on the Role enum in prisma/schema.prisma.
 *
 * `sessionVersion` is bumped so the change takes effect immediately rather
 * than whenever their token next happens to be reissued: somebody demoted
 * mid-session should not keep editing for the rest of the afternoon.
 */
export async function assignRole(params: {
  userId: string;
  roleId: string;
  /** Who is making the change; used for the self-edit rule. */
  actorId: string;
}) {
  if (params.userId === params.actorId) {
    // The rule that already applied to the old fixed roles, kept: it stops
    // both an accidental self-demotion that nobody else can undo, and a
    // moderator quietly promoting themselves.
    throw new RoleRuleError("You cannot change your own role.");
  }

  const [user, role] = await Promise.all([
    db.user.findUnique({
      where: { id: params.userId },
      select: { id: true, roleId: true, status: true, anonymisedAt: true },
    }),
    db.userRole.findUnique({
      where: { id: params.roleId },
      select: { id: true, tier: true, permissions: { select: { permission: true } } },
    }),
  ]);
  if (!user || user.anonymisedAt) throw new RoleRuleError("That account no longer exists.");
  if (!role) throw new RoleRuleError("That role no longer exists.");

  const grantsUserManagement = role.permissions.some((p) => p.permission === "user.manage");
  if (!grantsUserManagement) {
    await assertNotLastAdministrator(user.id);
  }

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        roleId: role.id,
        role: role.tier,
        // Takes effect on their very next request — see lib/auth/config.ts.
        sessionVersion: { increment: 1 },
      },
    }),
  ]);
}

/**
 * Refuses to move the last person who can manage people.
 *
 * Counts accounts that are active and hold a role granting `user.manage`.
 * Deliberately a count of *people who can*, not of people whose tier says
 * ADMIN: once roles are editable those are different questions, and this
 * is the one that decides whether anybody can still fix a mistake.
 */
export async function assertNotLastAdministrator(userIdBeingChanged: string) {
  const remaining = await db.user.count({
    where: {
      id: { not: userIdBeingChanged },
      status: "ACTIVE",
      anonymisedAt: null,
      userRole: { permissions: { some: { permission: "user.manage" } } },
    },
  });
  if (remaining === 0) {
    throw new RoleRuleError(
      "This is the only account that can manage people. Give somebody else that permission first."
    );
  }
}

/** Roles an administrator may choose from, ordered the way they are shown. */
export async function listRoles() {
  const roles = await db.userRole.findMany({
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      tier: true,
      isSystem: true,
      isProtected: true,
      permissions: { select: { permission: true } },
      _count: { select: { users: true } },
    },
  });

  // Highest access first, then alphabetically: an administrator scanning
  // this list is nearly always looking for the powerful ones.
  return roles
    .map((role) => ({ ...role, permissions: role.permissions.map((p) => p.permission).sort() }))
    .sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || a.name.localeCompare(b.name));
}

export type RoleSummary = Awaited<ReturnType<typeof listRoles>>[number];

/**
 * The role a brand-new account starts on.
 *
 * Every path that creates a User has to set this, or the account lands
 * with no role and therefore no permissions at all — it could not even
 * comment, and nothing would say why. There are four such paths
 * (registration, Google sign-up, an administrator adding somebody, and
 * bootstrap:staff), which is exactly why this is one function rather than
 * a string repeated four times.
 *
 * Falls back to the seeded id when the lookup finds nothing, so a database
 * that somehow missed the seed still produces a usable foreign key rather
 * than a null.
 */
export async function defaultRoleId(): Promise<string> {
  const role = await db.userRole.findUnique({ where: { key: "reader" }, select: { id: true } });
  return role?.id ?? "role_reader";
}

/** The seeded role behind a known key, for the scripts that need one by name. */
export async function roleIdByKey(key: string): Promise<string | null> {
  const role = await db.userRole.findUnique({ where: { key }, select: { id: true } });
  return role?.id ?? null;
}
