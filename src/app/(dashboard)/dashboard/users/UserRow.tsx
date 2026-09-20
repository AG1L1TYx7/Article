"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setUserRole, setUserStatus } from "./actions";

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
    <tr className="border-b border-neutral-200 align-top">
      <td className="py-3 pr-4">
        <p className="font-medium text-neutral-900">
          {user.name}
          {isSelf && <span className="ml-2 text-xs text-neutral-500">(you)</span>}
        </p>
        <p className="text-xs text-neutral-500">{user.email}</p>
        <p className="mt-1 flex gap-2 text-xs">
          {!user.verified && <span className="text-amber-700">unverified</span>}
          {user.mfaEnabled && <span className="text-emerald-700">2FA</span>}
        </p>
      </td>

      <td className="py-3 pr-4">
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
          className="rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </td>

      <td className="py-3 pr-4">
        <span className={suspended ? "text-red-700" : "text-neutral-700"}>{user.status}</span>
      </td>

      <td className="py-3 pr-4 text-neutral-600">
        {user.articles} article{user.articles === 1 ? "" : "s"}
        <br />
        <span className="text-xs text-neutral-500">
          {user.comments} comment{user.comments === 1 ? "" : "s"}
        </span>
      </td>

      <td className="py-3 pr-4 text-xs text-neutral-500">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "never"}
      </td>

      <td className="py-3">
        {!isSelf && (
          <button
            disabled={pending}
            onClick={() => run(() => setUserStatus(user.id, suspended ? "ACTIVE" : "SUSPENDED"))}
            className={`text-sm underline disabled:opacity-50 ${
              suspended ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {suspended ? "Reinstate" : "Suspend"}
          </button>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}
