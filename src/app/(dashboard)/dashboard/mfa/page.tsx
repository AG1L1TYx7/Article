import type { Metadata } from "next";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { EnrollMfaFlow } from "./EnrollMfaFlow";
import { DisableMfaForm } from "./DisableMfaForm";
import { PageBody, PageHeader } from "../../PageHeader";
import { ShieldIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Two-factor authentication", robots: { index: false, follow: false } };

export default async function MfaSettingsPage(props: PageProps<"/dashboard/mfa">) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Set by src/proxy.ts when somebody is sent here for checking reports
  // rather than for being an administrator. The two have different reasons
  // and different requirements, and being told the wrong one is how a
  // volunteer concludes the site is broken.
  const params = await props.searchParams;
  const sentHereToVerify =
    params.why === "verify" && session.user.permissions?.includes("issue.verify");

  return (
    <main id="main-content">
      <PageHeader
        kicker="Security"
        title="Two-factor authentication"
        description={
          sentHereToVerify
            ? "A second factor is required before you can check reports. Either an authenticator app or an emailed code will do."
            : "A six-digit code from an authenticator app, asked for at every sign-in on top of your password."
        }
      />

      <PageBody narrow>
        {sentHereToVerify && !session.user.mfaEnabled && (
          <p className="alert alert-warn mb-6">
            Checking reports means being able to see who filed every one of them, including the
            ones sent anonymously. On a platform where people report corruption in their own
            municipality, that name is the most dangerous thing here — so a stolen password must
            not be enough to reach it. Set up either method and the queue unlocks. An emailed
            code is fine if you would rather not install an app; you can turn that on from your{" "}
            <a href="/account" className="text-link">account page</a>.
          </p>
        )}
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
