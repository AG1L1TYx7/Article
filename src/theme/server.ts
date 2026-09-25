import { cache } from "react";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme, type Theme } from "./config";

/**
 * The request's theme, on the server: one cookie read per request
 * however many components ask (the masthead, the footer, the account
 * page and the root layout all do).
 */
export const getTheme = cache(async (): Promise<Theme> => {
  const jar = await cookies();
  return parseTheme(jar.get(THEME_COOKIE)?.value);
});
