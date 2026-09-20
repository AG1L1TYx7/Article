"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { checkMfaRequired } from "./actions";
import { safeRedirectPath } from "@/lib/safeRedirect";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Holds the verified-so-far credentials once a TOTP code is required, so
  // the second submit doesn't ask the user to retype their password.
  const [awaitingTotp, setAwaitingTotp] = useState<{ email: string; password: string } | null>(
    null
  );

  async function signInAndRedirect(email: string, password: string, totp?: string) {
    // Important: only include `totp` when it's a real code. next-auth's
    // client signIn() serializes credentials through `new URLSearchParams`,
    // which stringifies `totp: undefined` into the literal text
    // "undefined" — that then fails the server's 6-digit regex and
    // rejects *every* login, MFA or not. (Caught by e2e tests: all four
    // login-dependent MFA tests failed, including one for an account with
    // MFA disabled entirely.)
    const result = await signIn("credentials", {
      email,
      password,
      ...(totp ? { totp } : {}),
      redirect: false,
    });
    if (result?.error) {
      setError(awaitingTotp ? "Incorrect code." : "Incorrect email or password.");
      return;
    }
    // Only ever a path on this site: an attacker-supplied ?from= must not
    // be able to turn a successful login into a redirect to their domain.
    //
    // This used to check `from.startsWith("/")`, which is not enough —
    // "//evil.com" satisfies it and browsers resolve it to
    // https://evil.com. See lib/safeRedirect.ts.
    const destination = safeRedirectPath(params.get("from"), "/dashboard");

    // A full navigation, not router.push(), for two reasons. The client
    // Router Cache still holds pages rendered for the signed-out visitor,
    // so a soft navigation can land on stale signed-out content. And the
    // RSC request a soft push makes can race the session cookie the
    // sign-in just set: when it loses, proxy.ts sees no session and
    // bounces straight back to /login — which showed up as a rare, load-
    // dependent hang in the MFA e2e test, with the header already
    // rendering signed-in links while the URL had snapped back to /login.
    window.location.assign(destination);
  }

  async function onSubmitCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    const needsTotp = await checkMfaRequired(email, password);
    if (needsTotp) {
      setAwaitingTotp({ email, password });
      setPending(false);
      return;
    }

    await signInAndRedirect(email, password);
    setPending(false);
  }

  async function onSubmitTotp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!awaitingTotp) return;
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("totp"));
    await signInAndRedirect(awaitingTotp.email, awaitingTotp.password, code);
    setPending(false);
  }

  if (awaitingTotp) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="mb-2 text-2xl font-semibold">Enter your code</h1>
        <p className="mb-4 text-sm text-neutral-600">
          Open your authenticator app and enter the 6-digit code for this account.
        </p>
        <form onSubmit={onSubmitTotp} className="flex flex-col gap-4">
          <input
            name="totp"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            required
            className="rounded-md border border-neutral-300 px-3 py-2 text-center text-lg tracking-[0.4em] outline-none focus:border-neutral-500"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Verifying…" : "Verify"}
          </button>
        </form>
        <button
          onClick={() => setAwaitingTotp(null)}
          className="mt-4 text-sm text-neutral-600 underline"
        >
          Use a different account
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-2 text-2xl font-semibold">Log in</h1>
      {params.get("registered") && (
        <p className="mb-4 text-sm text-emerald-700">
          Account created — check your email to verify it, then log in below.
        </p>
      )}
      {params.get("reset") && (
        <p className="mb-4 text-sm text-emerald-700">
          Password updated — log in with your new password.
        </p>
      )}
      <form onSubmit={onSubmitCredentials} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
      <a href="/forgot-password" className="mt-4 text-sm text-neutral-600 underline">
        Forgot your password?
      </a>
    </main>
  );
}
