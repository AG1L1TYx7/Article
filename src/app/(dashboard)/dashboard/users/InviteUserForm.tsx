"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUser } from "./actions";
import { slugify } from "@/lib/slugify";
import { CheckIcon, PlusIcon, XIcon } from "@/components/icons";

const ROLES = [
  { value: "READER", label: "Reader", blurb: "Comments, saves, follows." },
  { value: "MODERATOR", label: "Writer & moderator", blurb: "Writes and publishes; reviews comments." },
  { value: "ADMIN", label: "Administrator", blurb: "Everything, including people. Must enrol 2FA." },
] as const;

/**
 * "Add person": an admin creates an account with a role in one step.
 * The temporary password is shown exactly once, here; it is never
 * emailed or logged. A reset link is emailed as well, so where mail is
 * configured the new person can ignore the temporary password entirely.
 */
export function InviteUserForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [role, setRole] = useState<(typeof ROLES)[number]["value"]>("MODERATOR");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; password: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName("");
    setEmail("");
    setHandle("");
    setHandleTouched(false);
    setRole("MODERATOR");
    setError(null);
    setCreated(null);
    setCopied(false);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await createUser({ name, email, handle, role });
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't create that account.");
      return;
    }
    setCreated({ name, email, password: result.temporaryPassword ?? "", emailed: !!result.emailed });
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary gap-1.5">
        <PlusIcon size={16} /> Add person
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="invite-heading">
      <div className="card w-full max-w-lg p-6 shadow-pop">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="invite-heading" className="headline text-2xl">
              {created ? "Account created" : "Add a person"}
            </h2>
            {!created && (
              <p className="mt-1 text-sm text-ink-2">
                They get a temporary password (shown to you once) and a reset link by email.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              reset();
            }}
            className="btn btn-ghost btn-icon"
            aria-label="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        {created ? (
          <div className="mt-5 flex flex-col gap-4">
            <p className="alert alert-ok flex items-center gap-2">
              <CheckIcon size={16} /> {created.name} can now log in as {created.email}.
            </p>
            <div className="field">
              <span className="label">Temporary password</span>
              <div className="flex gap-2">
                <code className="input flex-1 font-mono text-sm select-all">{created.password}</code>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(created.password);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      /* the field is select-all; they can copy by hand */
                    }
                  }}
                  className="btn btn-secondary"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="hint">
                Shown once — it is not stored anywhere you can see again. Pass it on privately and ask them to
                change it from their account page.
                {created.emailed
                  ? " A password-reset link was also emailed, so they may not need it at all."
                  : " Email could not be sent, so this is their only way in."}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={reset} className="btn btn-secondary">
                Add another
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="field">
                <label htmlFor="invite-name" className="label">
                  Name
                </label>
                <input
                  id="invite-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!handleTouched) setHandle(slugify(e.target.value).slice(0, 30));
                  }}
                  required
                  maxLength={120}
                  autoFocus
                  className="input"
                />
              </div>
              <div className="field">
                <label htmlFor="invite-handle" className="label">
                  Handle
                </label>
                <input
                  id="invite-handle"
                  value={handle}
                  onChange={(e) => {
                    setHandle(e.target.value.toLowerCase());
                    setHandleTouched(true);
                  }}
                  required
                  minLength={3}
                  maxLength={30}
                  pattern="[a-z0-9_\-]+"
                  className="input font-mono text-sm"
                />
                <p className="hint">Their public @name on bylines.</p>
              </div>
            </div>
            <div className="field">
              <label htmlFor="invite-email" className="label">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                className="input"
              />
            </div>
            <fieldset className="field">
              <legend className="label">Role</legend>
              <div className="mt-1 grid gap-2">
                {ROLES.map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors ${
                      role === r.value ? "border-ink bg-surface-2" : "border-line hover:border-line-strong"
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r.value}
                      checked={role === r.value}
                      onChange={() => setRole(r.value)}
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="font-medium">{r.label}</span>
                      <span className="block text-xs text-ink-3">{r.blurb}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" disabled={pending} className="btn btn-primary">
                {pending ? "Creating…" : "Create account"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
