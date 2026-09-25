/**
 * The reader's choice of light or dark.
 *
 * Three states, not two. "system" is the default and means "follow the
 * operating system", which is what most people want and what the site
 * did before there was a control. The other two override it, stamped on
 * <html data-theme> by the root layout from a cookie so the first paint
 * is already right — no flash of the wrong scheme, no JavaScript needed
 * to read a page in the chosen theme.
 *
 * The cookie holds one word and nothing about the person; the privacy
 * policy lists it alongside `locale`.
 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "system";

export const THEME_COOKIE = "theme";
/** A year, like the language: a preference, not something to ask about twice. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The paper colour of each scheme, for the browser chrome (theme-color). */
export const THEME_COLOR = { light: "#fafaf7", dark: "#111418" } as const;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * What goes on <html data-theme>: a forced scheme, or nothing at all so
 * the stylesheet's prefers-color-scheme rule decides.
 */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

/** A cookie value (or anything else) → a theme, with the default for junk. */
export function parseTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}
