"use client";

import { useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { resendVerificationEmail } from "@/app/(auth)/verify-email/actions";
import { useI18n } from "@/i18n/client";

const DISMISS_KEY = "verify-nudge-dismissed";
const DISMISS_EVENT = "verify-nudge-change";

// "Dismissed for this browser session" lives in sessionStorage, read
// through useSyncExternalStore so the server render (which cannot see it)
// and the first client render agree, and no effect has to set state.
function subscribe(onChange: () => void) {
  window.addEventListener(DISMISS_EVENT, onChange);
  return () => window.removeEventListener(DISMISS_EVENT, onChange);
}
function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
// On the server, and during hydration, treat it as hidden: the nudge
// then appears only once the client knows it was not dismissed.
const serverSnapshot = () => true;

/**
 * A quiet, persistent reminder for a signed-in reader who has not yet
 * confirmed their email address.
 *
 * Verification is asked for, not enforced: an unverified reader can read,
 * save, follow and use everything except the two actions where an
 * unconfirmed address is a real problem (commenting under a name nobody
 * can reach, and publishing). So this nudges rather than blocks — one
 * line under the masthead, a resend button, and "not now", which hides
 * it for this browser session only. It comes back next time, because the
 * address really does need confirming.
 *
 * Client-side, like the header's account links, so the shared layout
 * never has to read the session on the server.
 */
export function VerifyEmailNudge() {
  const { data: session, status } = useSession();
  const { t } = useI18n();
  const hidden = useSyncExternalStore(subscribe, readDismissed, serverSnapshot);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  if (status !== "authenticated" || !session?.user || session.user.emailConfirmed || hidden) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode: the nudge simply reappears on the next page.
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }

  return (
    <div className="border-b border-warn/30 bg-warn-soft/60" role="status" data-verify-nudge>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
        <p className="text-ink-2">{sent ? t("verify.nudgeSent") : t("verify.nudge")}</p>
        <span className="flex items-center gap-1">
          {!sent && (
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await resendVerificationEmail(session!.user!.email!);
                  setSent(true);
                } finally {
                  setPending(false);
                }
              }}
              className="btn btn-secondary btn-sm"
            >
              {pending ? t("verify.sending") : t("verify.resend")}
            </button>
          )}
          <button type="button" onClick={dismiss} className="btn btn-ghost btn-sm">
            {t("verify.dismiss")}
          </button>
        </span>
      </div>
    </div>
  );
}
