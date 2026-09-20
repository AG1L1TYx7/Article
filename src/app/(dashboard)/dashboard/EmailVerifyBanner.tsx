"use client";

import { useState } from "react";
import { resendVerificationEmail } from "@/app/(auth)/verify-email/actions";

export function EmailVerifyBanner({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div className="alert alert-warn mb-6 flex flex-wrap items-center justify-between gap-3">
      <span>
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
          className="btn btn-sm btn-secondary"
        >
          {pending ? "Sending…" : "Resend"}
        </button>
      )}
    </div>
  );
}
