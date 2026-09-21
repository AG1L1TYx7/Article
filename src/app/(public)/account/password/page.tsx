import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { safeRedirectPath } from "@/lib/safeRedirect";
import { one } from "@/lib/searchParams";
import { AuthCard } from "@/components/AuthCard";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Change password",
  robots: { index: false, follow: false },
};

/**
 * Two ways in: voluntarily from the account page, or compulsorily when
 * proxy.ts sends someone here because they signed in with a temporary
 * password. The form is the same; the words around it are not.
 */
export default async function ChangePasswordPage(props: PageProps<"/account/password">) {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/account/password");

  const { t } = await getI18n();
  const params = await props.searchParams;
  const required = session.user.mustChangePassword || one(params.required) === "1";
  const isStaff = session.user.role === "ADMIN" || session.user.role === "MODERATOR";
  const next = safeRedirectPath(one(params.from) || null, isStaff ? "/dashboard" : "/account");

  return (
    <div className="flex justify-center px-4 pt-10 pb-16 sm:px-6">
      <AuthCard
        title={required ? t("password.chooseOwn") : t("password.change")}
        intro={required ? t("password.requiredIntro") : t("password.intro")}
        footer={
          required ? undefined : (
            <Link href="/account" className="text-link">
              {t("password.backToAccount")}
            </Link>
          )
        }
      >
        <ChangePasswordForm required={required} next={next} />
      </AuthCard>
    </div>
  );
}
