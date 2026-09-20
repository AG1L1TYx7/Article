import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import Link from "next/link";
import { EnrollMfaFlow } from "./EnrollMfaFlow";
import { DisableMfaForm } from "./DisableMfaForm";

export default async function MfaSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Two-factor authentication</h1>

      {session.user.role === "ADMIN" && !session.user.mfaEnabled && (
        <p className="mt-2 text-sm text-amber-700">
          Admin accounts are required to enable this before using the rest of the dashboard.
        </p>
      )}

      <div className="mt-6">
        {session.user.mfaEnabled ? (
          <>
            <p className="mb-4 text-sm text-emerald-700">MFA is enabled on this account.</p>
            <DisableMfaForm />
          </>
        ) : (
          <EnrollMfaFlow />
        )}
      </div>

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-neutral-600 underline">
        Back to dashboard
      </Link>
    </main>
  );
}
