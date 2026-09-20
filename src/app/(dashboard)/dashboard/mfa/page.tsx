import type { Metadata } from "next";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { EnrollMfaFlow } from "./EnrollMfaFlow";
import { DisableMfaForm } from "./DisableMfaForm";
import { PageBody, PageHeader } from "../../PageHeader";
import { ShieldIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Two-factor authentication", robots: { index: false, follow: false } };

export default async function MfaSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main id="main-content">
      <PageHeader
        kicker="Security"
        title="Two-factor authentication"
        description="A six-digit code from an authenticator app, asked for at every sign-in on top of your password."
      />

      <PageBody narrow>
        {session.user.role === "ADMIN" && !session.user.mfaEnabled && (
          <p className="alert alert-warn mb-6">
            Admin accounts are required to enable this before using the rest of the dashboard.
            The other pages in the sidebar unlock as soon as you confirm a code below — it takes
            about a minute. No phone to hand? A password manager (1Password, Bitwarden) or a
            browser authenticator extension works the same way.
          </p>
        )}

        <div className="card p-6">
          <div className="flex items-center gap-3">
            <span
              className={`avatar h-10 w-10 ${
                session.user.mfaEnabled ? "bg-ok-soft text-ok ring-ok/20" : "bg-warn-soft text-warn ring-warn/20"
              }`}
            >
              <ShieldIcon size={18} />
            </span>
            <div>
              <p className="font-medium">
                {session.user.mfaEnabled ? "Two-factor authentication is on" : "Two-factor authentication is off"}
              </p>
              <p className="text-sm text-ink-2">
                {session.user.mfaEnabled
                  ? "Your account asks for a code at every sign-in."
                  : "Anyone with your password can sign in as you."}
              </p>
            </div>
          </div>

          <div className="mt-6 border-t border-line pt-6">
            {session.user.mfaEnabled ? (
              <>
                <p className="alert alert-ok mb-4" role="status">
                  MFA is enabled on this account.
                </p>
                <DisableMfaForm />
              </>
            ) : (
              <EnrollMfaFlow />
            )}
          </div>
        </div>
      </PageBody>
    </main>
  );
}
