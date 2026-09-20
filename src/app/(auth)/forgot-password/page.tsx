"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "./actions";
import { AuthCard } from "@/components/AuthCard";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    await requestPasswordReset(new FormData(e.currentTarget));
    setPending(false);
    setSubmitted(true);
  }

  return (
    <AuthCard
      title="Reset your password"
      intro={submitted ? undefined : "Enter the address you registered with and we'll send a link."}
      footer={
        <Link href="/login" className="text-link">
          Back to log in
        </Link>
      }
    >
      {submitted ? (
        <p className="alert alert-ok" role="status">
          If an account exists for that email, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="field">
            <span className="label">Email</span>
            <input name="email" type="email" autoComplete="email" required className="input" />
          </label>
          <button type="submit" disabled={pending} className="btn btn-primary mt-1 w-full py-2.5">
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
