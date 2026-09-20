"use client";

import { useState } from "react";
import Link from "next/link";
import { verifyEmail } from "./actions";
import { AuthCard } from "@/components/AuthCard";

type State = "idle" | "working" | "verified" | "failed";

export function VerifyEmailButton({ email, token }: { email: string; token: string }) {
  const [state, setState] = useState<State>("idle");

  if (state === "verified") {
    return (
      <AuthCard title="Email verified">
        <p className="alert alert-ok" role="status">
          Your email address has been confirmed.
        </p>
        <Link href="/login" className="btn btn-primary mt-6">
          Go to login
        </Link>
      </AuthCard>
    );
  }

  if (state === "failed") {
    return (
      <AuthCard title="Link expired or invalid">
        <p className="text-sm text-ink-2">
          This verification link is no longer valid. Log in and request a new one.
        </p>
        <Link href="/login" className="btn btn-primary mt-6">
          Go to login
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Confirm your email"
      intro={
        <>
          Confirming <strong className="text-ink">{email}</strong> for this account.
        </>
      }
    >
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
        className="btn btn-primary w-full py-2.5"
      >
        {state === "working" ? "Confirming…" : "Confirm my email"}
      </button>
    </AuthCard>
  );
}
