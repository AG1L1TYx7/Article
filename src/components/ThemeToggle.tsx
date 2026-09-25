"use client";

import { startTransition, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { setTheme, setThemeAndReturn } from "@/theme/actions";
import { THEMES, THEME_COLOR, parseTheme, themeAttribute, type Theme } from "@/theme/config";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

/**
 * System / Light / Dark, as a segmented control.
 *
 * The choice is applied to <html data-theme> the instant it is clicked
 * and stored in a cookie by a server action, so the next page — and the
 * next visit — paints in it before any script runs. Every instance on
 * the page (masthead, footer, account) reads the same attribute, so
 * changing one changes them all. Without JavaScript the same buttons
 * submit a form that stores the choice and reloads the page.
 */
const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

// The <html> attribute is the single source of truth on the client; the
// store just watches it, so several toggles never disagree.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const readTheme = () => parseTheme(document.documentElement.dataset.theme);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const value = themeAttribute(theme);
  if (value) root.dataset.theme = value;
  else delete root.dataset.theme;

  // Keep the browser chrome (address bar on phones, title bar in an
  // installed app) in the paper colour of what is now on screen.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = value ?? (meta.media?.includes("dark") ? "dark" : "light");
    meta.content = THEME_COLOR[scheme];
  }
}

export function ThemeToggle({
  initial,
  variant = "compact",
}: {
  /** The theme the server rendered with, so hydration matches the cookie. */
  initial: Theme;
  /** "compact": icons only. "row": icons with their names, for settings pages. */
  variant?: "compact" | "row";
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const current = useSyncExternalStore(subscribe, readTheme, () => initial);

  function choose(theme: Theme) {
    applyTheme(theme);
    startTransition(() => {
      void setTheme(theme);
    });
  }

  return (
    <form
      action={setThemeAndReturn}
      role="radiogroup"
      aria-label={t("theme.label")}
      data-theme-toggle={current}
      className="inline-flex items-center rounded-full border border-line bg-surface p-0.5"
    >
      <input type="hidden" name="returnTo" value={pathname} />
      {THEMES.map((theme) => {
        const Icon = ICONS[theme];
        const label = t(`theme.${theme}`);
        const active = theme === current;
        return (
          <button
            key={theme}
            type="submit"
            name="theme"
            value={theme}
            role="radio"
            aria-checked={active}
            aria-label={variant === "compact" ? label : undefined}
            title={variant === "compact" ? label : undefined}
            onClick={(e) => {
              e.preventDefault();
              choose(theme);
            }}
            className={`inline-flex h-7 min-w-7 cursor-pointer items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-colors ${
              variant === "row" ? "px-3" : "px-1.5"
            } ${active ? "bg-ink text-paper" : "text-ink-3 hover:bg-surface-2 hover:text-ink"}`}
          >
            <Icon size={14} />
            {variant === "row" && <span>{label}</span>}
          </button>
        );
      })}
    </form>
  );
}
