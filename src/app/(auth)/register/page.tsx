"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerUser } from "./actions";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-6 text-2xl font-semibold">Create an account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Name" name="name" autoComplete="name" required />
        <Field label="Handle" name="handle" autoComplete="username" required pattern="[a-z0-9_\-]+" />
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
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending || (botCheckRequired && !botToken)}
          className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </main>
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
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-neutral-700">{label}</span>
      <input
        {...rest}
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      />
      {helper && <span className="text-xs text-neutral-500">{helper}</span>}
    </label>
  );
}
