"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setUserRole, setUserStatus } from "./actions";
import { formatDate, initials } from "@/lib/format";
import { ShieldIcon } from "@/components/icons";

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  handle: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  verified: boolean;
  articles: number;
  comments: number;
  lastLoginAt: string | null;
}

const ROLES = ["READER", "MODERATOR", "ADMIN"];

export function UserRow({ user, isSelf }: { user: ManagedUser; isSelf: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return;
    }
    router.refresh();
  }

  const suspended = user.status !== "ACTIVE";

  return (
    <tr className={`${pending ? "opacity-60" : ""} hover:bg-surface-2/60`}>
      <td className="pl-4">
        <div className="flex items-center gap-3">
          <span className="avatar h-9 w-9 text-xs">{initials(user.name)}</span>
          <div className="min-w-0">
            <p className="font-medium text-ink">
              {user.name}
              {isSelf && <span className="ml-2 text-xs font-normal text-ink-3">(you)</span>}
            </p>
            <p className="truncate text-xs text-ink-3">
              {user.email} · @{user.handle}
            </p>
            <p className="mt-1 flex flex-wrap gap-1">
              {!user.verified && <span className="pill pill-warn">unverified</span>}
              {user.mfaEnabled && (
                <span className="pill pill-ok">
                  <ShieldIcon size={11} /> 2FA
                </span>
              )}
            </p>
          </div>
        </div>
      </td>

      <td>
        <label className="sr-only" htmlFor={`role-${user.id}`}>
          Role for {user.name}
        </label>
        <select
          id={`role-${user.id}`}
          value={user.role}
          // Changing your own role is the one way to lock yourself out of
          // this page, so the control is not offered at all rather than
          // being offered and then refused.
          disabled={pending || isSelf}
          onChange={(e) => run(() => setUserRole(user.id, e.target.value))}
          className="input w-auto py-1 text-xs"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </td>

      <td>
        <span className={`pill ${suspended ? "pill-danger" : "pill-ok"}`}>{user.status}</span>
      </td>

      <td className="text-ink-2">
        {user.articles} article{user.articles === 1 ? "" : "s"}
        <br />
        <span className="text-xs text-ink-3">
          {user.comments} comment{user.comments === 1 ? "" : "s"}
        </span>
      </td>

      <td className="text-xs whitespace-nowrap text-ink-3">
        {user.lastLoginAt ? formatDate(user.lastLoginAt) : "never"}
      </td>

      <td className="pr-4 text-right">
        {!isSelf && (
          <button
            disabled={pending}
            onClick={() => run(() => setUserStatus(user.id, suspended ? "ACTIVE" : "SUSPENDED"))}
            className={`btn btn-sm ${suspended ? "btn-secondary text-ok" : "btn-ghost text-danger"}`}
          >
            {suspended ? "Reinstate" : "Suspend"}
          </button>
        )}
        {error && (
          <p className="mt-1 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}
