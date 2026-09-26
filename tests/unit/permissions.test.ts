import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  CRITICAL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  SYSTEM_ROLES,
  isKnownPermission,
  tierAllows,
} from "@/lib/auth/permissions";

/**
 * The permission catalogue and the three roles seeded from it.
 *
 * These are not style checks. A duplicate key silently overrides another
 * permission; a system role granting something its tier forbids produces a
 * role whose ticked boxes do nothing; and an administrator role that does
 * not hold the critical permissions is a site nobody can administer — all
 * three are invisible until the day they matter.
 */
describe("catalogue", () => {
  it("has no duplicate keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("keys are dotted lowercase, so they sort and read predictably", () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });

  it("every permission is reachable from a group", () => {
    const fromGroups = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
    expect(fromGroups.sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("every permission explains itself", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission.label.length, permission.key).toBeGreaterThan(0);
      // The description is what an administrator reads before granting it;
      // a stub here is how somebody ticks a box they do not understand.
      expect(permission.description.length, permission.key).toBeGreaterThan(30);
    }
  });

  it("recognises its own keys and nothing else", () => {
    expect(isKnownPermission("user.manage")).toBe(true);
    expect(isKnownPermission("article.embargo")).toBe(false);
    expect(isKnownPermission("")).toBe(false);
  });
});

describe("tier rules", () => {
  it("a member cannot hold a staff permission", () => {
    expect(tierAllows("READER", "article.publish")).toBe(false);
    expect(tierAllows("READER", "comment.create")).toBe(true);
  });

  it("staff cannot hold an administration permission", () => {
    expect(tierAllows("MODERATOR", "user.manage")).toBe(false);
    expect(tierAllows("MODERATOR", "article.publish")).toBe(true);
  });

  it("an administrator can hold anything in the catalogue", () => {
    for (const key of PERMISSION_KEYS) {
      expect(tierAllows("ADMIN", key), key).toBe(true);
    }
  });

  it("an unknown key is never allowed, at any tier", () => {
    for (const tier of ["READER", "MODERATOR", "ADMIN"] as const) {
      expect(tierAllows(tier, "article.embargo")).toBe(false);
    }
  });
});

describe("seeded roles", () => {
  it("every permission they grant exists", () => {
    for (const role of SYSTEM_ROLES) {
      for (const key of role.permissions) {
        expect(isKnownPermission(key), `${role.key} grants ${key}`).toBe(true);
      }
    }
  });

  it("no role grants something its own tier forbids", () => {
    // Otherwise the box is ticked in the editor and the permission never
    // applies, because the tier gate runs first.
    for (const role of SYSTEM_ROLES) {
      for (const key of role.permissions) {
        expect(tierAllows(role.tier, key), `${role.key} grants ${key}`).toBe(true);
      }
    }
  });

  it("the administrator role holds every permission there is", () => {
    const admin = SYSTEM_ROLES.find((r) => r.key === "admin")!;
    expect([...admin.permissions].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("the administrator role is the protected one, and holds the critical permissions", () => {
    const admin = SYSTEM_ROLES.find((r) => r.key === "admin")!;
    expect(admin.isProtected).toBe(true);
    for (const key of CRITICAL_PERMISSIONS) {
      expect(admin.permissions).toContain(key);
    }
  });

  it("the critical permissions are the ones that administer the site", () => {
    // If this list ever shrinks, the protection in roleService.ts protects
    // less than it claims to — so the list is asserted, not just read.
    expect([...CRITICAL_PERMISSIONS].sort()).toEqual(["role.manage", "user.manage"]);
  });

  it("no lesser role can administer the site", () => {
    for (const role of SYSTEM_ROLES) {
      if (role.key === "admin") continue;
      for (const key of CRITICAL_PERMISSIONS) {
        expect(role.permissions, `${role.key} must not grant ${key}`).not.toContain(key);
      }
    }
  });

  it("a member can do nothing in the staff area", () => {
    const reader = SYSTEM_ROLES.find((r) => r.key === "reader")!;
    expect(reader.permissions).not.toContain("dashboard.access");
    expect(reader.tier).toBe("READER");
  });

  it("staff can reach the staff area, or their other permissions are unreachable", () => {
    const moderator = SYSTEM_ROLES.find((r) => r.key === "moderator")!;
    expect(moderator.permissions).toContain("dashboard.access");
  });

  it("the three built-in keys are exactly what the migration and scripts expect", () => {
    // bootstrap-staff.ts, scripts/cpanel-setup.cjs, the seed and the
    // migration all look roles up by these keys.
    expect(SYSTEM_ROLES.map((r) => r.key).sort()).toEqual(["admin", "moderator", "reader"]);
    for (const role of SYSTEM_ROLES) expect(role.isSystem).toBe(true);
  });
});
