"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteMyAccount, updateProfile } from "./actions";
import { PenIcon, TrashIcon } from "@/components/icons";

/**
 * The rights a person can exercise without asking anyone: correct their
 * name, download everything, delete the account. Kept on the account
 * page rather than behind a support address because a right you have to
 * write in for is a right most people never use.
 */
export function AccountPrivacy({ name: initialName, canDelete }: { name: string; canDelete: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function saveName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingName(true);
    setNameError(null);
    const result = await updateProfile({ name });
    setSavingName(false);
    if (!result.ok) {
      setNameError(result.error ?? "Couldn't save that.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function remove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteMyAccount({ password });
    if (!result.ok) {
      setDeleting(false);
      setDeleteError(result.error ?? "Couldn't delete the account.");
      return;
    }
    // A full navigation on purpose: the session no longer exists, and a
    // soft navigation would show the router's cached signed-in pages.
    window.location.assign(new URL("/?deleted=1", window.location.origin).toString());
  }

  return (
    <section className="card mt-4 p-6" aria-labelledby="privacy-heading">
      <h2 id="privacy-heading" className="text-lg font-medium">
        Your data
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        Everything here is yours to see, correct and remove. The{" "}
        <Link href="/privacy" className="text-link">
          privacy policy
        </Link>{" "}
        says what is held and why.
      </p>

      <dl className="mt-5 divide-y divide-line border-t border-line">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <dt className="text-sm font-medium">Name</dt>
            {editing ? (
              <form onSubmit={saveName} className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={120}
                  autoFocus
                  aria-label="Name"
                  className="input w-64"
                />
                <button type="submit" disabled={savingName || !name.trim()} className="btn btn-primary btn-sm">
                  {savingName ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setName(initialName);
                    setEditing(false);
                    setNameError(null);
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
                {nameError && (
                  <span className="text-xs text-danger" role="alert">
                    {nameError}
                  </span>
                )}
              </form>
            ) : (
              <dd className="text-sm text-ink-2">{initialName}</dd>
            )}
          </div>
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className="btn btn-secondary btn-sm gap-1">
              <PenIcon size={14} /> Edit
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <dt className="text-sm font-medium">Download your data</dt>
            <dd className="text-sm text-ink-2">
              Your account details, comments, likes, saved articles, follows and sign-in history, as a JSON file.
            </dd>
          </div>
          <a href="/account/data" download className="btn btn-secondary btn-sm">
            Download
          </a>
        </div>

        <div className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <dt className="text-sm font-medium">Delete your account</dt>
              <dd className="text-sm text-ink-2">
                {canDelete
                  ? "Erases your name, email, password and settings immediately and removes your comments. This cannot be undone."
                  : "This account has written articles. Ask an admin to reassign them first; then the account can be deleted."}
              </dd>
            </div>
            {canDelete && !confirming && (
              <button type="button" onClick={() => setConfirming(true)} className="btn btn-danger btn-sm gap-1">
                <TrashIcon size={14} /> Delete account
              </button>
            )}
          </div>

          {confirming && (
            <form onSubmit={remove} className="alert alert-danger mt-4 flex flex-col gap-3">
              <p className="font-medium">This is permanent.</p>
              <label className="field">
                <span className="text-sm">
                  Type <strong>delete my account</strong> to confirm
                </span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="input" />
              </label>
              <label className="field">
                <span className="text-sm">Your password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input"
                />
              </label>
              {deleteError && (
                <p className="text-sm" role="alert">
                  {deleteError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={deleting || typed.trim().toLowerCase() !== "delete my account" || !password}
                  className="btn btn-danger btn-sm"
                >
                  {deleting ? "Deleting…" : "Delete my account"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setTyped("");
                    setPassword("");
                    setDeleteError(null);
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  Keep my account
                </button>
              </div>
            </form>
          )}
        </div>
      </dl>
    </section>
  );
}
