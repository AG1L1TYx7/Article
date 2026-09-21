import { headers } from "next/headers";
import { setLocale } from "@/i18n/actions";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { getI18n } from "@/i18n/server";

/**
 * One button per other language. A form, not a link: the choice is
 * stored in a cookie by a server action, so it works with JavaScript off
 * and does not need every URL to carry a language prefix.
 *
 * Each language is written in its own name ("नेपाली", not "Nepali"),
 * because the person who needs the button is the one who cannot read the
 * current language.
 */
export async function LanguageSwitcher({ variant = "inline" }: { variant?: "inline" | "row" }) {
  const { locale, t } = await getI18n();
  const h = await headers();
  // Where to come back to. The proxy records the path so this works from
  // any page without threading it through props.
  const returnTo = h.get("x-pathname") ?? "/";

  const others = LOCALES.filter((l) => l !== locale);

  return (
    <form action={setLocale} className={variant === "row" ? "flex flex-wrap items-center gap-2" : "inline-flex flex-wrap items-center gap-2"}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <span className="text-xs text-ink-3">
        {t("language.label")}: <span className="text-ink-2">{LOCALE_NAMES[locale]}</span>
      </span>
      {others.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          lang={l}
          title={t("language.switchTo", { language: LOCALE_NAMES[l] })}
          className="btn btn-ghost btn-sm"
        >
          {LOCALE_NAMES[l]}
        </button>
      ))}
    </form>
  );
}
