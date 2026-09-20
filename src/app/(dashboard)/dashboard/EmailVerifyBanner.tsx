"use client";

import { useState } from "react";
import { resendVerificationEmail } from "@/app/(auth)/verify-email/actions";

export function EmailVerifyBanner({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div className="mt-4 flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
      <span className="text-amber-900">
        {sent ? "Check your inbox for a new verification link." : "Your email address isn't verified yet."}
      </span>
      {!sent && (
        <button
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await resendVerificationEmail(email);
            setPending(false);
            setSent(true);
          }}
          className="font-medium text-amber-900 underline disabled:opacity-50"
        >
          {pending ? "Sending…" : "Resend"}
        </button>
      )}
    </div>
  );
}
