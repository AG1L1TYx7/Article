/**
 * Every permission this application knows how to check.
 *
 * The catalogue is code, not data, and that is deliberate. A permission
 * only means something because a line of code asks for it — invent
 * "article.embargo" in a database table and nothing anywhere will ever
 * consult it, so the administrator who ticked it has been told a
 * comforting lie about what their newsroom can do. Every large system
 * that gets this right works the same way: you compose roles, you do not
 * compose permissions. GitHub, Linear and Google Workspace all let you
 * build a role out of a fixed vocabulary.
 *
 * Roles, by contrast, are data — see prisma/schema.prisma. An
 * administrator creates as many as they like out of this list.
 *
 * Adding one:
 *   1. add it here, in the group it belongs to;
 *   2. check it where it matters, with requirePermission();
 *   3. add it to whichever system roles should have it in
 *      DEFAULT_ROLE_PERMISSIONS below.
 * A permission absent from step 3 is simply one nobody has yet, which is
 * the safe direction to fail.
 *
 * This module imports nothing. It is read by the database seed, by the
 * server-side gates and by the browser (the role editor renders the same
 * descriptions an administrator ticks), so it must stay free of both
 * Prisma and React.
 */

/** The coarse tier a role belongs to. Mirrors the Role enum in the schema. */
export type Tier = "READER" | "MODERATOR" | "ADMIN";

export interface PermissionDefinition {
  key: string;
  /** What an administrator sees in the role editor. */
  label: string;
  /** What granting it actually lets somebody do, in plain words. */
  description: string;
  /**
   * The lowest tier that can hold this permission.
   *
   * A tier is what decides whether somebody may open /dashboard at all
   * (see src/proxy.ts), so granting "article.publish" to a role that
   * cannot reach the newsroom would produce a permission that silently
   * never applies. The role editor refuses that combination rather than
   * saving something inert.
   */
  minTier: Tier;
  /**
   * True when removing this permission from every role would leave the
   * site unadministrable. Guarded in the role editor — see
   * lib/auth/roleGuards.ts.
   */
  critical?: boolean;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDefinition[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "workspace",
    label: "Staff workspace",
    permissions: [
      {
        key: "dashboard.access",
        label: "Open the staff area",
        description:
          "Reach /dashboard at all. Without this, every other staff permission is unreachable.",
        minTier: "MODERATOR",
      },
      {
        key: "analytics.view",
        label: "See analytics",
        description: "What is being read, where readers come from, and how far down they get.",
        minTier: "MODERATOR",
      },
    ],
  },
  {
    key: "content",
    label: "Published content",
    permissions: [
      {
        key: "article.create",
        label: "Write articles",
        description: "Start a new piece and save it as a draft.",
        minTier: "MODERATOR",
      },
      {
        key: "article.edit.own",
        label: "Edit their own articles",
        description: "Change pieces they wrote themselves, published or not.",
        minTier: "MODERATOR",
      },
      {
        key: "article.edit.any",
        label: "Edit anyone's articles",
        description:
          "Change anything on the site, including other people's. This is the difference between a contributor and an editor.",
        minTier: "MODERATOR",
      },
      {
        key: "article.publish",
        label: "Publish and unpublish",
        description:
          "Put something in front of the public, or take it back down. Separate from writing on purpose: most teams want a second pair of eyes before anything goes out — and for a verified citizen report that second pair of eyes is the whole point.",
        minTier: "MODERATOR",
      },
      {
        key: "article.delete",
        label: "Remove articles",
        description: "Take something out of circulation. It is flagged as removed, never erased.",
        minTier: "MODERATOR",
      },
      {
        key: "media.upload",
        label: "Upload photo and video",
        description: "Add images and video. Requires a verified email address as well.",
        minTier: "MODERATOR",
      },
    ],
  },
  {
    key: "community",
    label: "Community",
    permissions: [
      {
        key: "comment.create",
        label: "Write comments",
        description:
          "Join the discussion. Every member has this; removing it from the member role closes discussion to everybody.",
        minTier: "READER",
      },
      {
        key: "comment.moderate",
        label: "Moderate comments",
        description: "Approve, reject and remove comments, and work the moderation queue.",
        minTier: "MODERATOR",
      },
    ],
  },
  {
    key: "issues",
    label: "Reported issues",
    permissions: [
      {
        key: "issue.submit",
        label: "Report an issue",
        description:
          "Raise something happening where they live. Every member has this; removing it from the member role closes reporting to everybody.",
        minTier: "READER",
      },
      {
        key: "issue.verify",
        label: "Check reports before anyone sees them",
        description:
          "Read the queue of unpublished reports, ask the reporter questions, and mark a report verified or rejected. This also means seeing who filed an anonymous report, so grant it to people you would trust with that name.",
        minTier: "MODERATOR",
      },
      {
        key: "issue.publish",
        label: "Publish a verified report",
        description:
          "Make a checked report public, which also alerts members in that district. Separate from verifying on purpose: the two-person rule is what stops one mistaken or malicious account putting an unchecked accusation in front of a whole district.",
        minTier: "MODERATOR",
      },
      {
        key: "issue.resolve",
        label: "Mark a report resolved",
        description:
          "Record that the thing complained about was actually dealt with, with a note saying how.",
        minTier: "MODERATOR",
      },
    ],
  },
  {
    key: "support",
    label: "Membership and donations",
    permissions: [
      {
        key: "contribution.view",
        label: "See contributions",
        description:
          "Read who has given what, including names and amounts. Grant it to the people who keep the books and to nobody else \u2014 a donor list is a list of who supports this work, which in some districts is a sensitive thing to be on.",
        minTier: "MODERATOR",
      },
      {
        key: "contribution.confirm",
        label: "Confirm money arrived",
        description:
          "Mark a pledged contribution as received once it shows up in the account, or record a refund. This is the permission that moves money in the records, so it belongs to a treasurer rather than to everybody on the team.",
        minTier: "MODERATOR",
      },
      {
        key: "membership.manage",
        label: "Set membership rates",
        description:
          "Create and change what memberships cost and how long they last, and edit the bank details shown to contributors.",
        minTier: "ADMIN",
      },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    permissions: [
      {
        key: "category.manage",
        label: "Manage sections",
        description: "Create, rename and remove the sections things are filed under.",
        minTier: "ADMIN",
      },
      {
        key: "settings.manage",
        label: "Change site settings",
        description: "How much discussion moderation the site does, and the other site-wide switches.",
        minTier: "ADMIN",
      },
      {
        key: "user.manage",
        label: "Manage people",
        description:
          "Add accounts, change what role somebody has, and suspend or restore them.",
        minTier: "ADMIN",
        critical: true,
      },
      {
        key: "role.manage",
        label: "Manage roles",
        description:
          "Create roles and decide what each one may do — including this one. Grant it carefully: anybody with it can give themselves anything else.",
        minTier: "ADMIN",
        critical: true,
      },
      {
        key: "auditlog.view",
        label: "Read the audit log",
        description:
          "See every privileged action and every sign-in attempt. Read-only: nothing anywhere can alter or delete these entries.",
        minTier: "ADMIN",
      },
    ],
  },
];

/** Every permission, flattened. */
export const ALL_PERMISSIONS: PermissionDefinition[] = PERMISSION_GROUPS.flatMap(
  (group) => group.permissions
);

export const PERMISSION_KEYS: string[] = ALL_PERMISSIONS.map((p) => p.key);

const BY_KEY = new Map(ALL_PERMISSIONS.map((p) => [p.key, p]));

export function permissionDefinition(key: string): PermissionDefinition | undefined {
  return BY_KEY.get(key);
}

/** True for a key this application actually checks somewhere. */
export function isKnownPermission(key: string): boolean {
  return BY_KEY.has(key);
}

/** Permissions that, if nobody held them, would leave the site unadministrable. */
export const CRITICAL_PERMISSIONS: string[] = ALL_PERMISSIONS.filter((p) => p.critical).map(
  (p) => p.key
);

const TIER_RANK: Record<Tier, number> = { READER: 0, MODERATOR: 1, ADMIN: 2 };

/** Whether a role at this tier is allowed to hold this permission at all. */
export function tierAllows(tier: Tier, key: string): boolean {
  const definition = BY_KEY.get(key);
  if (!definition) return false;
  return TIER_RANK[tier] >= TIER_RANK[definition.minTier];
}

export function tierRank(tier: Tier): number {
  return TIER_RANK[tier];
}

/**
 * The three roles the site is seeded with, and what they may do.
 *
 * These reproduce exactly what the hard-coded roles did before roles
 * became editable, so upgrading an existing site changes nobody's
 * abilities on the day it happens. An administrator is then free to
 * adjust them, or to build something in between — "sub-editor" who can
 * edit anyone's copy but not publish it is the usual first one.
 */
export const SYSTEM_ROLES: {
  key: string;
  name: string;
  description: string;
  tier: Tier;
  /** Cannot be deleted, and its key cannot change. */
  isSystem: true;
  /** Additionally cannot lose the critical permissions. */
  isProtected?: boolean;
  permissions: string[];
}[] = [
  {
    key: "reader",
    name: "Reader",
    description:
      "Everybody who registers. Can read, comment, react, save and follow — and nothing in the staff area.",
    tier: "READER",
    isSystem: true,
    permissions: ["comment.create", "issue.submit"],
  },
  {
    key: "moderator",
    name: "Moderator",
    description:
      "Staff. Writes and publishes, and works the moderation queue. Cannot manage people, sections or settings.",
    tier: "MODERATOR",
    isSystem: true,
    permissions: [
      "dashboard.access",
      "analytics.view",
      "article.create",
      "article.edit.own",
      "article.publish",
      "article.delete",
      "media.upload",
      "comment.create",
      "comment.moderate",
      "issue.submit",
      "issue.verify",
      "issue.publish",
      "issue.resolve",
      "contribution.view",
      "contribution.confirm",
    ],
  },
  {
    key: "admin",
    name: "Administrator",
    description:
      "Everything, including who else may do what. Two-factor authentication is mandatory for this tier.",
    tier: "ADMIN",
    isSystem: true,
    isProtected: true,
    permissions: PERMISSION_KEYS,
  },
];

/** The permissions a freshly seeded system role starts with, by key. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = Object.fromEntries(
  SYSTEM_ROLES.map((role) => [role.key, role.permissions])
);
