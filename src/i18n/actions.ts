"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from "./config";
import { safeRedirectPath } from "@/lib/safeRedirect";

/**
 * Remembers the reader's language choice and returns them to the page
 * they were on.
 *
 * A plain form action so the switcher works before hydration and with
 * JavaScript off. The cookie is a preference, not tracking: it holds two
 * letters and nothing about the person, and the privacy policy lists it.
 */
export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  const returnTo = safeRedirectPath(String(formData.get("returnTo") ?? ""), "/");

  if (isLocale(locale)) {
    (await cookies()).set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }

  redirect(returnTo);
}
