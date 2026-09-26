import { redirect } from "next/navigation";
import { readStepUpToken } from "@/lib/auth/oauthFlow";
import { StepUpForm } from "./StepUpForm";

/**
 * The second factor, after Google has said who somebody is.
 *
 * Reached only as the redirect the signIn callback returns when the
 * matched account has two-factor enabled and this device is not a
 * remembered one. No session exists at this point — that is the entire
 * design: Google identified the person, and until a current code is
 * entered they are not signed in to anything.
 *
 * The token in the query string names the account and nothing else, and
 * it is useless without a code. It cannot leak to a third party either:
 * the site sends `Referrer-Policy: strict-origin-when-cross-origin`
 * (proxy.ts), so any cross-origin request made from this page carries the
 * origin only, never this path or its query.
 *
 * Validated here so that an expired or forged token shows the login page
 * again instead of a form that could never succeed; the real check is in
 * the "mfa-continue" provider, which re-reads every condition at the
 * moment it would issue the session.
 */
export default async function StepUpPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; m?: string }>;
}) {
  const { t: token, m: method } = await searchParams;
  if (!token || !readStepUpToken(token)) {
    redirect("/login?error=mfa_expired");
  }
  // The signIn callback appends this and has already sent the code when it
  // says "email"; anything else means an authenticator app.
  return <StepUpForm token={token} byEmail={method === "email"} />;
}
