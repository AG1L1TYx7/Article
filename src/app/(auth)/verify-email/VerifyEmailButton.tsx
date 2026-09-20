"use client";

import { useState } from "react";
import Link from "next/link";
import { verifyEmail } from "./actions";

type State = "idle" | "working" | "verified" | "failed";

export function VerifyEmailButton({ email, token }: { email: string; token: string }) {
  const [state, setState] = useState<State>("idle");

  if (state === "verified") {
    return (
      <>
        <h1 className="text-2xl font-semibold">Email verified</h1>
        <p className="mt-2 text-neutral-600">Your email address has been confirmed.</p>
        <Link
          href="/login"
          className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Go to login
        </Link>
      </>
    );
  }

  if (state === "failed") {
    return (
      <>
        <h1 className="text-2xl font-semibold">Link expired or invalid</h1>
        <p className="mt-2 text-neutral-600">
          This verification link is no longer valid. Log in and request a new one.
        </p>
        <Link
          href="/login"
          className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Go to login
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Confirm your email</h1>
      <p className="mt-2 text-neutral-600">
        Confirming <strong>{email}</strong> for this account.
      </p>
      <button
        disabled={state === "working"}
        onClick={async () => {
          setState("working");
          try {
            setState((await verifyEmail(email, token)) ? "verified" : "failed");
          } catch {
            setState("failed");
          }
        }}
        className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {state === "working" ? "Confirming…" : "Confirm my email"}
      </button>
    </>
  );
}
