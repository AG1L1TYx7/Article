"use client";

import { useState, useTransition } from "react";
import type { PermissionGroup, Tier } from "@/lib/auth/permissions";
import type { RoleSummary } from "@/lib/auth/roleService";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "./actions";

/**
 * The role editor.
 *
 * One list, with an inline editor per role and one for a new role. The
 * permission checkboxes are the same catalogue the server validates
 * against, so what an administrator sees is exactly what can be saved —
 * and a permission the role's access level forbids is shown disabled with
 * the reason, rather than silently rejected after they press Save.
 */

const TIERS: { value: Tier; label: string; help: string }[] = [
  { value: "READER", label: "Member", help: "Cannot open the staff area at all." },
  { value: "MODERATOR", label: "Staff", help: "Can open the staff area." },
  {
    value: "ADMIN",
    label: "Administrator",
    help: "Can open the staff area. Two-factor authentication becomes compulsory.",
  },
];

const TIER_RANK: Record<Tier, number> = { READER: 0, MODERATOR: 1, ADMIN: 2 };

export function RoleList({
  roles,
  groups,
  currentUserId,
}: {
  roles: RoleSummary[];
  groups: PermissionGroup[];
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="grid gap-4">
      {roles.map((role) =>
        editing === role.id ? (
          <RoleEditor
            key={role.id}
            role={role}
            groups={groups}
            onDone={() => setEditing(null)}
          />
        ) : (
          <RoleCard
            key={role.id}
            role={role}
            groups={groups}
            onEdit={() => setEditing(role.id)}
          />
        )
      )}

      {creating ? (
        <RoleEditor role={null} groups={groups} onDone={() => setCreating(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="btn btn-secondary w-full py-3"
        >
          Create a role
        </button>
      )}

      <p className="px-1 text-xs text-ink-3">
        Signed in as the account that cannot change its own role — that rule stops a
        one-click self-demotion nobody else can undo. Ask another administrator if you
        need your own changed. (Account {currentUserId.slice(-6)}.)
      </p>
    </div>
  );
}

function RoleCard({
  role,
  groups,
  onEdit,
}: {
  role: RoleSummary;
  groups: PermissionGroup[];
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tier = TIERS.find((t) => t.value === role.tier)!;
  const total = groups.flatMap((g) => g.permissions).length;

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteRoleAction(role.id);
      if (!result.ok) setError(result.error ?? "Could not delete that role.");
    });
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-medium">{role.name}</h3>
            <span className="rounded-full border border-rule px-2 py-0.5 text-xs text-ink-2">
              {tier.label}
            </span>
            {role.isSystem && (
              <span className="rounded-full border border-rule px-2 py-0.5 text-xs text-ink-3">
                built in
              </span>
            )}
          </div>
          {role.description && <p className="mt-1 text-sm text-ink-2">{role.description}</p>}
          <p className="mt-2 text-xs text-ink-3">
            {role.permissions.length} of {total} permissions ·{" "}
            {role._count.users === 1 ? "1 person" : `${role._count.users} people`} ·{" "}
            <code>{role.key}</code>
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onEdit} className="btn btn-secondary btn-sm">
            Edit
          </button>
          {!role.isSystem && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending || role._count.users > 0}
              title={
                role._count.users > 0
                  ? "Move the people holding this role to another one first."
                  : undefined
              }
              className="btn btn-secondary btn-sm"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function RoleEditor({
  role,
  groups,
  onDone,
}: {
  role: RoleSummary | null;
  groups: PermissionGroup[];
  onDone: () => void;
}) {
  const [tier, setTier] = useState<Tier>(role?.tier ?? "MODERATOR");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    // Checkboxes disabled by the tier rule are not submitted by the
    // browser, which is the behaviour we want — but the selection state
    // may still hold them from before the tier changed, so the form is
    // the single source of what gets sent.
    startTransition(async () => {
      const result = role
        ? await updateRoleAction(role.id, formData)
        : await createRoleAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not save that role.");
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card border-2 border-accent/40 p-5">
      <h3 className="text-lg font-medium">{role ? `Edit ${role.name}` : "New role"}</h3>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span className="label">Name</span>
          <input
            name="name"
            defaultValue={role?.name ?? ""}
            required
            maxLength={60}
            className="input"
          />
        </label>

        {role ? (
          <div className="field">
            <span className="label">Identifier</span>
            <input value={role.key} disabled className="input opacity-60" />
            <span className="mt-1 text-xs text-ink-3">
              Fixed once created — code and seeds refer to it.
            </span>
          </div>
        ) : (
          <label className="field">
            <span className="label">Identifier</span>
            <input
              name="key"
              required
              pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
              placeholder="section-moderator"
              className="input"
            />
            <span className="mt-1 text-xs text-ink-3">
              Lowercase letters, numbers and hyphens. Cannot be changed later.
            </span>
          </label>
        )}
      </div>

      <label className="field mt-4">
        <span className="label">Description</span>
        <input
          name="description"
          defaultValue={role?.description ?? ""}
          maxLength={200}
          placeholder="What this role is for, in one line."
          className="input"
        />
      </label>

      <fieldset className="mt-5">
        <legend className="label">Access level</legend>
        <p className="mb-2 text-xs text-ink-3">
          Decides whether the staff area opens at all, and whether two-factor
          authentication is compulsory. It cannot be changed on a built-in role.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {TIERS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-2 rounded-md border p-3 text-sm ${
                tier === option.value ? "border-accent" : "border-rule"
              } ${role?.isSystem ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="tier"
                value={option.value}
                checked={tier === option.value}
                disabled={role?.isSystem}
                onChange={() => setTier(option.value)}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-ink-3">{option.help}</span>
              </span>
            </label>
          ))}
        </div>
        {/* A disabled radio submits nothing, so a built-in role would post
            no tier at all and the server would read it as READER. Carry it
            explicitly; the server ignores it for system roles regardless. */}
        {role?.isSystem && <input type="hidden" name="tier" value={role.tier} />}
      </fieldset>

      <div className="mt-6 grid gap-5">
        {groups.map((group) => (
          <fieldset key={group.key}>
            <legend className="label">{group.label}</legend>
            <div className="mt-2 grid gap-2">
              {group.permissions.map((permission) => {
                const allowedByTier = TIER_RANK[tier] >= TIER_RANK[permission.minTier];
                const locked = role?.isProtected && permission.critical;
                return (
                  <label
                    key={permission.key}
                    className={`flex items-start gap-2.5 rounded-md border border-rule p-3 text-sm ${
                      allowedByTier ? "" : "opacity-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="permission"
                      value={permission.key}
                      checked={selected.has(permission.key) && allowedByTier}
                      disabled={!allowedByTier || locked}
                      onChange={(e) => toggle(permission.key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="font-medium">{permission.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-2">
                        {permission.description}
                      </span>
                      {!allowedByTier && (
                        <span className="mt-1 block text-xs text-ink-3">
                          Needs the {TIERS.find((t) => t.value === permission.minTier)!.label}{" "}
                          access level or higher.
                        </span>
                      )}
                      {locked && (
                        <span className="mt-1 block text-xs text-ink-3">
                          The administrator role always keeps this one.
                        </span>
                      )}
                    </span>
                    {/* A disabled checkbox is not submitted, so a locked
                        permission would be stripped on save. Send it. */}
                    {locked && (
                      <input type="hidden" name="permission" value={permission.key} />
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Saving…" : role ? "Save changes" : "Create role"}
        </button>
        <button type="button" onClick={onDone} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
