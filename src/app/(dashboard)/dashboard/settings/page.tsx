import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getSettings, resetSettingsCache } from "@/lib/settings";
import { PageBody, PageHeader } from "../../PageHeader";
import { SettingsForm } from "./SettingsForm";
import { SmtpForm } from "./SmtpForm";
import { SupportSettingsForm } from "./SupportForm";
import { getSupportSettings } from "@/lib/contributions";
import { sessionHas } from "@/lib/auth/rbac";
import { getSmtpConfig } from "@/lib/smtp";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  // The admin editing settings should see the stored value, not a
  // cached one from up to a minute ago.
  resetSettingsCache();
  const settings = await getSettings();
  const smtp = await getSmtpConfig();
  const support = await getSupportSettings();

  return (
    <main id="main-content">
      <PageHeader
        kicker="Site"
        title="Settings"
        description="How the site behaves for everyone. Changes take effect within a minute and are recorded in the audit log."
      />
      <PageBody narrow>
        <SettingsForm initial={settings} />
        <SmtpForm initial={smtp} adminEmail={session.user.email ?? ""} />
        {sessionHas(session, "membership.manage") && <SupportSettingsForm initial={support} />}
      </PageBody>
    </main>
  );
}
