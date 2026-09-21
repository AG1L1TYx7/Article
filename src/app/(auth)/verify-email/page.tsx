import Link from "next/link";
import { VerifyEmailButton } from "./VerifyEmailButton";
import { AuthCard } from "@/components/AuthCard";
import { getI18n } from "@/i18n/server";

// Verification deliberately happens on a button press, not on page load.
// These tokens are single use, and corporate mail scanners (Outlook Safe
// Links and friends), chat-app link unfurlers, and browser prefetch all
// fetch links before a human ever clicks them — verifying during a GET
// render means the token is routinely burned in transit and the real user
// arrives to "link expired".
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;

  if (token && email) {
    return <VerifyEmailButton email={email} token={token} />;
  }

  const { t } = await getI18n();
  return (
    <AuthCard title={t("auth.linkExpired")}>
      <p className="text-sm text-ink-2">{t("auth.verifyMissing")}</p>
      <Link href="/login" className="btn btn-primary mt-6">
        {t("auth.goToLogin")}
      </Link>
    </AuthCard>
  );
}
