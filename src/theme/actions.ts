"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, isTheme } from "./config";
import { safeRedirectPath } from "@/lib/safeRedirect";

async function writeThemeCookie(theme: string) {
  const jar = await cookies();
  if (theme === "system") {
    // "Follow the system" is the absence of a preference, so the cookie
    // goes rather than storing a word that means "nothing".
    jar.delete(THEME_COOKIE);
    return;
  }
  jar.set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
    // Deliberately readable by the page's own script: the toggle applies
    // the choice instantly and keeps the cookie in step. It holds one
    // word about the display and nothing about the person.
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * Remembers the theme. Called by the toggle after it has already applied
 * the choice on the page, so there is nothing to redirect to.
 */
export async function setTheme(theme: string): Promise<void> {
  if (isTheme(theme)) await writeThemeCookie(theme);
}

/**
 * The same, as a plain form action for JavaScript-off readers: store the
 * choice and send them back to the page they were on, which now renders
 * in that theme from the cookie.
 */
export async function setThemeAndReturn(formData: FormData): Promise<void> {
  const theme = formData.get("theme");
  const returnTo = safeRedirectPath(String(formData.get("returnTo") ?? ""), "/");
  if (isTheme(theme)) await writeThemeCookie(theme);
  redirect(returnTo);
}
