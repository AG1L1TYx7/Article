"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "./actions";
import { AuthCard } from "@/components/AuthCard";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await resetPassword(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.push("/login?reset=1");
  }

  if (!token || !email) {
    return (
      <AuthCard
        title="Link incomplete"
        footer={
          <Link href="/forgot-password" className="text-link">
            Request a new reset link
          </Link>
        }
      >
        <p className="text-sm text-ink-2">This reset link is missing required parameters.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" intro={<>For <strong className="text-ink">{email}</strong>.</>}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} />
        <label className="field">
          <span className="label">New password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className="input"
          />
          <span className="hint">At least 12 characters.</span>
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary mt-1 w-full py-2.5">
          {pending ? "Saving…" : "Save new password"}
        </button>
      </form>
    </AuthCard>
  );
}
