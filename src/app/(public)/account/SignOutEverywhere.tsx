"use client";

import { useState, useTransition } from "react";
import { signOutEverywhere } from "./actions";

/**
 * "Sign out everywhere", with a confirmation step.
 *
 * Worth a confirmation because it signs this browser out too — unavoidably,
 * since sessions are counted per account rather than per device. Somebody
 * who presses it expecting only their old phone to be logged out and finds
 * themselves at the login page would reasonably think the site had broken.
 */
export function SignOutEverywhere() {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await signOutEverywhere();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      // A full document navigation, deliberately, rather than
      // router.push: every session for this account has just been
      // revoked, so the router's cached RSC payloads — which still show
      // a signed-in account page — are all lies. Throwing the document
      // away is the only way to be sure none of them is rendered. The
      // lint rule is about avoiding needless full page loads; here the
      // full load is the point.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login?signedOut=1");
    });
  }

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="btn btn-secondary btn-sm">
        Sign out everywhere
      </button>
    );
  }

  return (
    <div className="text-right">
      <p className="mb-2 max-w-xs text-xs text-ink-2">
        Ends every session on every device — including this one, so you will need to sign in
        again. Use it if you think somebody else has access to your account.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={confirm} disabled={pending} className="btn btn-primary btn-sm">
          {pending ? "Ending…" : "Yes, sign out everywhere"}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="btn btn-secondary btn-sm">
          Cancel
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
