"use client";

import { useState, useTransition } from "react";
import { sendTestEmail, updateSmtpSettings } from "./actions";
import { ALLOWED_SMTP_PORTS, type SmtpConfigView } from "@/lib/smtpConfig";

/**
 * The mail server settings.
 *
 * Two things this form does deliberately:
 *
 * The password field starts empty even when one is stored, and an empty
 * field means "leave it alone". Rendering the stored password back into a
 * value attribute would publish it to every extension in the browser and
 * to whoever next opens devtools, for no gain — nobody needs to read a
 * password they already set.
 *
 * "Send a test" is beside Save rather than hidden somewhere, because the
 * alternative way to find out mail is broken is somebody failing to reset
 * their password at midnight.
 */
export function SmtpForm({ initial, adminEmail }: { initial: SmtpConfigView; adminEmail: string }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [secure, setSecure] = useState(initial.secure);
  const [user, setUser] = useState(initial.user);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [fromName, setFromName] = useState(initial.fromName);

  const [testTo, setTestTo] = useState(adminEmail);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateSmtpSettings(
        { enabled, host, port, secure, user, fromEmail, fromName },
        // undefined keeps what is stored; "" clears it.
        clearPassword ? "" : password ? password : undefined
      );
      setMessage(
        result.ok
          ? { ok: true, text: "Saved." }
          : { ok: false, text: result.error ?? "Could not save." }
      );
      if (result.ok) {
        setPassword("");
        setClearPassword(false);
      }
    });
  }

  function onTest() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendTestEmail(testTo);
      setMessage(
        result.ok
          ? { ok: true, text: `Sent to ${testTo}. If it does not arrive, check the spam folder.` }
          : { ok: false, text: result.error ?? "Could not send." }
      );
    });
  }

  return (
    <form onSubmit={onSave} className="card mt-6 p-6">
      <h2 className="text-lg font-medium">Mail server (SMTP)</h2>
      <p className="mt-1 text-sm text-ink-2">
        Where password resets, email verification and sign-in codes are sent from. When this is
        off, the site falls back to Resend if a key is configured, and otherwise writes mail to a
        log file for development.
      </p>

      <label className="mt-5 flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium">Send mail through this server</span>
          <span className="mt-0.5 block text-xs text-ink-3">
            Turn on once the test below succeeds. Until then, leave it off so sign-ins keep
            working by whatever route they use now.
          </span>
        </span>
      </label>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span className="label">Host</span>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.gmail.com"
            className="input"
          />
        </label>

        <label className="field">
          <span className="label">Port</span>
          <select
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className="input"
          >
            {ALLOWED_SMTP_PORTS.map((p) => (
              <option key={p} value={p}>
                {p}
                {p === 587 ? " — submission (usual)" : ""}
                {p === 465 ? " — implicit TLS" : ""}
                {p === 25 ? " — often blocked" : ""}
                {p === 2525 ? " — alternative" : ""}
                {p === 1025 ? " — local test server" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={secure}
          onChange={(e) => setSecure(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium">Implicit TLS</span>
          <span className="mt-0.5 block text-xs text-ink-3">
            On for port 465. Off for 587 and 25, which start in the clear and upgrade with
            STARTTLS. Getting this the wrong way round is the most common reason a connection
            hangs.
          </span>
        </span>
      </label>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span className="label">Username</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="off"
            placeholder="Usually the full email address"
            className="input"
          />
          <span className="mt-1 text-xs text-ink-3">
            Leave blank for a relay that authenticates by IP address.
          </span>
        </label>

        <label className="field">
          <span className="label">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={clearPassword}
            autoComplete="new-password"
            placeholder={initial.hasPassword ? "Stored — leave blank to keep it" : ""}
            className="input"
          />
          <span className="mt-1 text-xs text-ink-3">
            Never shown back, here or anywhere. Gmail and Google Workspace accounts with
            two-factor authentication need an App Password, not the account password.
          </span>
          {initial.hasPassword && (
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={clearPassword}
                onChange={(e) => setClearPassword(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Remove the stored password
            </label>
          )}
        </label>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span className="label">From address</span>
          <input
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="no-reply@yourdomain.org"
            className="input"
          />
          <span className="mt-1 text-xs text-ink-3">
            Must be an address this server is allowed to send for, or it will refuse the message.
          </span>
        </label>

        <label className="field">
          <span className="label">From name</span>
          <input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="The Dispatch"
            className="input"
          />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-line pt-5">
        <label className="field flex-1 min-w-56">
          <span className="label">Send a test to</span>
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            className="input"
          />
        </label>
        <button
          type="button"
          onClick={onTest}
          disabled={pending}
          className="btn btn-secondary py-2.5"
        >
          Send a test
        </button>
        <button type="submit" disabled={pending} className="btn btn-primary py-2.5">
          {pending ? "Working…" : "Save"}
        </button>
      </div>

      {message && (
        <p
          className={`mt-4 text-sm ${message.ok ? "text-ink-2" : "text-danger"}`}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      )}

      <p className="mt-4 text-xs text-ink-3">
        The password is encrypted with the site&rsquo;s <code>AUTH_SECRET</code>. Changing that
        value makes the stored password unreadable — the fix is to type it in here again, the
        same as re-enrolling an authenticator app.
      </p>
    </form>
  );
}
