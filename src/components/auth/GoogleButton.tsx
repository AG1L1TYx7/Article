"use client";

import { useFormStatus } from "react-dom";

/**
 * The "Continue with Google" button, and the rule above it.
 *
 * The mark is inlined as SVG rather than loaded from Google's CDN. A
 * hosted image would mean every visitor to the login page makes a request
 * to Google carrying their IP address before they have chosen anything —
 * the same objection that makes lib/auth/avatar.ts re-host pictures — and
 * it would need a CSP exception for an origin we otherwise never talk to.
 *
 * Colours are Google's own, which their branding guidelines require and
 * which is also what makes the button recognisable at a glance. It is
 * therefore deliberately *not* themed with this site's tokens.
 */

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg className="size-5" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GoogleButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  // Reads the pending state of the enclosing <form>, so the button
  // disables itself for the moment between the click and the browser
  // leaving for Google — long enough on a slow connection to click twice.
  //
  // `disabled` is the caller's own reason, and on the registration page it
  // is the terms checkbox. That is a courtesy, not the control: the server
  // action refuses without consent, and so does the signIn callback. A
  // disabled button is only what stops somebody wondering why nothing
  // happened.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="flex w-full items-center justify-center gap-3 rounded-md border border-rule bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition hover:bg-[#f8f9fa] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
    >
      {pending ? <Spinner /> : <GoogleMark />}
      <span>{label}</span>
    </button>
  );
}

/** A labelled rule, for putting Google above the email form. */
export function OrSeparator({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-rule" />
      <span className="text-xs uppercase tracking-wide text-ink-2">{label}</span>
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}
