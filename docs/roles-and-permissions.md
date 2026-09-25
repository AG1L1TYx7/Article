# Roles and permissions

Administrators build roles. Code checks permissions. Those are two
different things on purpose, and keeping them apart is what makes this
survive the platform growing.

---

## The shape of it

**Permissions are code.** The catalogue lives in
`src/lib/auth/permissions.ts` and nowhere else. A permission means
something only because a line of code asks for it — invent
`issue.escalate` in a database table and nothing anywhere will consult it,
so the administrator who ticked the box has been told a comforting lie
about what their team can do. Every system that gets this right works the
same way: you compose roles, you do not compose permissions.

**Roles are data.** `UserRole` and `RolePermission` in the schema. An
administrator creates as many as the work needs, out of the catalogue, at
`/dashboard/roles`.

**Three roles are seeded** and reproduce exactly what the hard-coded roles
did before, so upgrading an existing site changes nobody's abilities on the
day it happens:

| Role | Tier | Holds |
| --- | --- | --- |
| Reader | Member | `comment.create` |
| Moderator | Staff | The staff area, writing, publishing, moderating |
| Administrator | Administrator | Everything |

They cannot be deleted. Their permissions stay editable — except the
administrator role, which always keeps `user.manage` and `role.manage`.

---

## Tier and permission are different questions

Every role sits in one of three **tiers**, and `User.role` keeps a copy of
its role's tier. This is not duplication left by accident; the tier answers
two questions that have to be answerable from the session token on every
single request, before any permission is consulted:

- may this person open `/dashboard` at all (`src/proxy.ts`);
- is two-factor authentication compulsory for them.

`User.roleId` is the real relationship. `User.role` is a denormalised copy
of `UserRole.tier`, and exactly one function writes it — `assignRole()` in
`lib/auth/roleService.ts`, which writes both columns in one transaction, so
the two cannot drift.

A permission whose `minTier` is above a role's tier cannot be saved against
it. Otherwise the box would be ticked in the editor and the permission
would never apply, because the tier gate runs first.

---

## Checking a permission

```ts
import { requirePermission, sessionHas } from "@/lib/auth/rbac";

// Server action or route handler — throws, and guardAction() turns that
// into a normal { ok: false } for a form.
await requirePermission("article.publish");

// Any one of several.
await requirePermission("article.edit.any", "article.edit.own");

// Rendering: hide what they cannot do. Never the only check.
{sessionHas(session, "role.manage") && <Link href="/dashboard/roles">Roles</Link>}
```

The permission list rides on the session token and is refreshed from the
database by the `jwt` callback on **every request**, on the query that
already runs there — so a permission withdrawn stops applying on the very
next request rather than whenever the token happens to expire, and the
checks cost no extra query. That is the same guarantee `sessionVersion`
gives for revoked sessions.

`requireRole()` still exists and still works. New code should prefer
`requirePermission()`; the older call sites are being migrated as they are
touched, which is safe precisely because the seeded roles grant exactly
what the tiers used to.

---

## The rules that stop a lock-out

A permission system that lets you remove the last person who can manage
people is not a permission system, it is a trapdoor — and the recovery from
it is a database console, which on shared hosting may not exist. All of
these are enforced in `lib/auth/roleService.ts`, not in the pages, because
most of them can be reached from two directions (editing the role, or
moving the person) and a rule written twice is a rule enforced once:

| Refused | Why |
| --- | --- |
| Deleting a built-in role | The seed, the migration and `bootstrap:staff` all look these up by key |
| Changing a built-in role's tier | `admin` meaning ADMIN is wired into mandatory two-factor |
| Taking `user.manage` or `role.manage` off the administrator role | Nobody could put it back through the application |
| Deleting a role somebody still holds | They would silently drop to no permissions at all |
| Changing your own role | No accidental self-demotion, no quiet self-promotion |
| Moving the last account that can manage people | Verified by counting who **can**, not whose tier says ADMIN — once roles are editable those are different questions |
| Granting a permission nothing checks | It would promise an ability that does not exist |
| Granting a permission above the role's tier | It would never apply |

Each is refused with a sentence saying what to do instead.

Every create, edit, delete and assignment writes an audit entry. `role.manage`
is the permission that can grant every other permission, so its use is the
use that most needs to be on the record.

---

## Adding a permission

1. Add it to the right group in `src/lib/auth/permissions.ts`, with a
   description an administrator can act on and the lowest `minTier` that
   makes sense.
2. Check it where it matters with `requirePermission()`.
3. Add it to whichever entries in `SYSTEM_ROLES` should have it.
4. `npm run seed` — the reconciliation pass gives it to the built-in roles
   that should have it, adding only what is missing. Roles an administrator
   created, and permissions they deliberately removed from a non-protected
   role, are left exactly as they are.

A permission missing from step 3 is simply one nobody has yet, which is the
safe direction to fail.

---

## Where this is going

This platform is not only a publication. It is a civic space with many
administrators, in many places, working on separate concerns — one team on
corruption, another on drugs, another on a province's local issues. Two
things follow, and the design above is shaped to accept both without a
rewrite:

**Scope.** Today a role is global: an issue verifier verifies everywhere.
The natural next step is an *assignment* that carries a scope — this role,
in this section, or in this province — so that a verifier for Madhesh
Province cannot publish a report from Karnali. The place for it is a join
table between user and role carrying an optional scope, with
`requirePermission()` gaining an optional scope argument. Nothing above has
to change for that: permissions stay a fixed vocabulary, roles stay
bundles, and the tier still answers the two questions it answers now.

**More permissions, not more tiers.** Membership, donations, verified
citizen reports and geographic notification each bring privileged actions —
approving a member, refunding a donation, verifying a report, sending an
alert to a province. Each is a permission added by the four steps above,
granted to whichever roles a team decides. The three tiers are deliberately
coarse and should stay that way: they are a routing and 2FA question, not a
description of anybody's job.

What should **not** happen is a fourth hard-coded tier, or a permission
string invented in the database. Both undo the separation this page exists
to describe.
