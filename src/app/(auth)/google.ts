"use server";

import { cookies } from "next/headers";
import { signIn, googleEnabled } from "@/lib/auth/config";
import { CONSENT_COOKIE, issueConsentToken } from "@/lib/auth/oauthFlow";
import { safeRedirectPath } from "@/lib/safeRedirect";

/**
 * Starting a Google sign-in, from the server.
 *
 * Both entry points go through a server action rather than the client's
 * `signIn("google")` for one reason: consent has to be recorded before the
 * browser leaves for Google, and only the server can set the HttpOnly
 * cookie that carries it back. Doing the sign-in the same way from both
 * pages keeps one code path instead of two that must agree.
 *
 * `signIn()` finishes by throwing a redirect, which is how Next.js server
 * actions navigate — so nothing after it runs, and it must not be wrapped
 * in a try/catch that would swallow the redirect.
 */

/**
 * Signing IN with Google.
 *
 * A record of consent is minted here as well, even though most people
 * arriving at /login already have an account and agreed long ago. The
 * reason is the one case that is not most people: somebody who has never
 * registered, pressing "Continue with Google" on the login page. Their
 * account would be created on the way back, and without a record taken
 * beforehand the only honest thing left to do is refuse and send them to
 * /register to agree — a dead end, for somebody who did nothing wrong.
 *
 * So the login page carries the agreement as a notice under the button
 * ("By continuing with Google you confirm you are 16 or older and agree
 * to the terms and the privacy policy"), which is the conspicuous
 * clickwrap that pressing it accepts, and this records it. For anybody
 * who already has an account the token is simply never read: consent is
 * only ever consulted at the moment an account is created.
 */
export async function startGoogleSignIn(formData: FormData) {
  if (!googleEnabled) return;

  const { token, expires } = issueConsentToken();
  (await cookies()).set(CONSENT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });

  const redirectTo = safeRedirectPath(formData.get("from")?.toString() ?? null) || "/";
  await signIn("google", { redirectTo });
}

/**
 * Signing UP: the terms box must be ticked, and a signed record of that
 * goes with them to Google and back.
 *
 * The check is here, on the server, and again in the signIn callback,
 * which refuses to create an account without the cookie. A required
 * attribute in the form is a convenience for the person filling it in;
 * it is not evidence of anything, and GDPR Art. 7(1) asks for evidence.
 */
export async function startGoogleSignUp(formData: FormData) {
  if (!googleEnabled) return;

  if (formData.get("googleConsent") !== "on") {
    const { redirect } = await import("next/navigation");
    redirect("/register?error=consent_required");
  }

  const { token, expires } = issueConsentToken();
  (await cookies()).set(CONSENT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });

  await signIn("google", { redirectTo: "/" });
}
