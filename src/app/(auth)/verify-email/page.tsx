import Link from "next/link";
import { VerifyEmailButton } from "./VerifyEmailButton";

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

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 text-center">
      {token && email ? (
        <VerifyEmailButton email={email} token={token} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Link expired or invalid</h1>
          <p className="mt-2 text-neutral-600">
            This verification link is missing information. Log in and request a new one.
          </p>
          <Link
            href="/login"
            className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            Go to login
          </Link>
        </>
      )}
    </main>
  );
}
