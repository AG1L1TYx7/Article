"use client";

import { useState } from "react";
import { resendVerificationEmail } from "@/app/(auth)/verify-email/actions";
import { useI18n } from "@/i18n/client";

export function EmailVerifyBanner({ email }: { email: string }) {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div className="alert alert-warn mb-6 flex flex-wrap items-center justify-between gap-3">
      <span>{sent ? t("verify.checkInbox") : t("verify.notVerified")}</span>
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
          {pending ? t("verify.sending") : t("verify.resend")}
        </button>
      )}
    </div>
  );
}
