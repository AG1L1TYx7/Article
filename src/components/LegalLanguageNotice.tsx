import { DEFAULT_LOCALE } from "@/i18n/config";
import { getI18n } from "@/i18n/server";

/**
 * Shown at the top of the privacy policy and the terms when the reader's
 * interface is not English. Those two pages are kept in English only —
 * a translated policy is a legal document in its own right — so the one
 * honest thing to do is say so, in the reader's language.
 */
export async function LegalLanguageNotice() {
  const { locale, t } = await getI18n();
  if (locale === DEFAULT_LOCALE) return null;
  return (
    <p className="alert alert-warn mt-4" role="note">
      {t("common.languageNotice")}
    </p>
  );
}
