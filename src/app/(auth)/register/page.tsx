"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerUser } from "./actions";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { AuthCard } from "@/components/AuthCard";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Turnstile injects its own hidden cf-turnstile-response input into the
  // form, so the token reaches the server action via FormData without us
  // passing it. This state only drives the disabled button, and stays
  // irrelevant when Turnstile is not configured.
  const botCheckRequired = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [botToken, setBotToken] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await registerUser(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.push("/login?registered=1");
  }

  return (
    <AuthCard
      title="Create an account"
      intro={
        <>
          Save articles, follow writers and join the discussion.
          <span className="mt-1 block text-xs text-ink-3">
            This creates a reader account. Newsroom access is granted by an editor, never by signing up.
          </span>
        </>
      }
      footer={
        <>
          Already have one?{" "}
          <Link href="/login" className="text-link font-medium">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Name" name="name" autoComplete="name" required />
        <Field
          label="Handle"
          name="handle"
          autoComplete="username"
          required
          pattern="[a-z0-9_\-]+"
          helper="Lowercase letters, numbers, hyphens and underscores. This is your public @name."
        />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          helper="At least 12 characters."
        />
        <TurnstileWidget onToken={setBotToken} />
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
          <span className="text-ink-2">
            I am 16 or older and I agree to the{" "}
            <Link href="/terms" className="text-link" target="_blank">
              terms of use
            </Link>{" "}
            and the{" "}
            <Link href="/privacy" className="text-link" target="_blank">
              privacy policy
            </Link>
            .
          </span>
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || (botCheckRequired && !botToken)}
          className="btn btn-primary mt-1 w-full py-2.5"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  pattern?: string;
  helper?: string;
}) {
  const { label, helper, ...rest } = props;
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input {...rest} className="input" />
      {helper && <span className="hint">{helper}</span>}
    </label>
  );
}
