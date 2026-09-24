"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { updateProfile } from "./actions";
import { PenIcon, UserIcon } from "@/components/icons";
import { displayName, PROFILE_LIMITS, suggestNameParts } from "@/lib/profile";
import { useI18n } from "@/i18n/client";

type Details = {
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  bio: string | null;
};

/**
 * First, last and preferred name, and "about you". Every signed-in person
 * can edit their own, readers and staff alike.
 *
 * Accounts from before these fields existed have only `name`; for those
 * the form starts from a split of it rather than blank, since retyping
 * your own name is a chore. Nothing is saved until the person saves, so
 * a wrong split (family name first, a single name) is theirs to correct.
 */
export function ProfileDetails({
  details,
  name,
  isStaff,
}: {
  details: Details;
  name: string;
  isStaff: boolean;
}) {
  const router = useRouter();
  const { update: refreshSession } = useSession();
  const { t } = useI18n();
  const neverSet = !details.firstName && !details.lastName && !details.preferredName;
  const start = neverSet
    ? { ...suggestNameParts(name), preferredName: "", bio: details.bio ?? "" }
    : {
        firstName: details.firstName ?? "",
        lastName: details.lastName ?? "",
        preferredName: details.preferredName ?? "",
        bio: details.bio ?? "",
      };

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(start);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // What the site would show if saved now, so the effect of a preferred
  // name is visible before committing to it.
  const preview =
    displayName({
      firstName: form.firstName.trim() || null,
      lastName: form.lastName.trim() || null,
      preferredName: form.preferredName.trim() || null,
    }) || "—";

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await updateProfile(form);
    setSaving(false);
    if (!result.ok) {
      setError({ message: result.error ?? t("account.couldntSaveThat"), field: result.field });
      return;
    }
    setEditing(false);
    setSaved(true);
    router.refresh();
    // The header reads the session on the client, fetched once per page
    // load; ask for it again so its initials follow the new name now.
    await refreshSession();
  }

  function cancel() {
    setForm(start);
    setError(null);
    setEditing(false);
  }

  const fieldError = (field: string) =>
    error?.field === field ? (
      <span id={`${field}-error`} className="hint text-danger" role="alert">
        {error.message}
      </span>
    ) : null;

  const rows: { label: string; value: string | null }[] = [
    { label: t("account.firstName"), value: details.firstName },
    { label: t("account.lastName"), value: details.lastName },
    { label: t("account.preferredName"), value: details.preferredName },
  ];

  return (
    <section className="card mt-4 p-6" aria-labelledby="personal-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="personal-heading" className="flex items-center gap-2 text-lg font-medium">
            <UserIcon size={18} /> {t("account.personalInfo")}
          </h2>
          <p className="mt-1 text-sm text-ink-2">{t("account.personalInfoBlurb")}</p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
            className="btn btn-secondary btn-sm gap-1"
          >
            <PenIcon size={14} /> {t("account.editDetails")}
          </button>
        )}
      </div>

      {saved && !editing && (
        <p className="alert alert-ok mt-4" role="status">
          {t("account.detailsSaved")}
        </p>
      )}

      {!editing ? (
        <dl className="mt-5 divide-y divide-line border-t border-line">
          <div className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
            <dt className="text-sm font-medium">{t("account.shownAs")}</dt>
            <dd className="text-sm">{name}</dd>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
              <dt className="text-sm font-medium">{row.label}</dt>
              <dd className={`text-sm ${row.value ? "text-ink-2" : "text-ink-3 italic"}`}>{row.value ?? t("account.notSet")}</dd>
            </div>
          ))}
          <div className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
            <dt className="text-sm font-medium">{t("account.about")}</dt>
            <dd className={`text-sm whitespace-pre-line ${details.bio ? "text-ink-2" : "text-ink-3 italic"}`}>
              {details.bio ?? t("account.notSet")}
            </dd>
          </div>
        </dl>
      ) : (
        <form onSubmit={save} className="mt-5 flex flex-col gap-4 border-t border-line pt-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field">
              <span className="label">{t("account.firstName")}</span>
              <input
                name="firstName"
                value={form.firstName}
                onChange={set("firstName")}
                autoComplete="given-name"
                maxLength={PROFILE_LIMITS.name}
                autoFocus
                aria-invalid={error?.field === "firstName" || undefined}
                aria-describedby={error?.field === "firstName" ? "firstName-error" : undefined}
                className="input"
              />
              {fieldError("firstName")}
            </label>
            <label className="field">
              <span className="label">
                {t("account.lastName")} <span className="font-normal text-ink-3">{t("common.optional")}</span>
              </span>
              <input
                name="lastName"
                value={form.lastName}
                onChange={set("lastName")}
                autoComplete="family-name"
                maxLength={PROFILE_LIMITS.name}
                aria-invalid={error?.field === "lastName" || undefined}
                className="input"
              />
              {fieldError("lastName")}
            </label>
          </div>

          <label className="field">
            <span className="label">
              {t("account.preferredName")} <span className="font-normal text-ink-3">{t("common.optional")}</span>
            </span>
            <input
              name="preferredName"
              value={form.preferredName}
              onChange={set("preferredName")}
              autoComplete="nickname"
              maxLength={PROFILE_LIMITS.name}
              aria-invalid={error?.field === "preferredName" || undefined}
              className="input sm:max-w-sm"
            />
            <span className="hint">{t("account.preferredNameHint")}</span>
            {fieldError("preferredName")}
          </label>

          <label className="field">
            <span className="label">
              {t("account.about")} <span className="font-normal text-ink-3">{t("common.optional")}</span>
            </span>
            <textarea
              name="bio"
              value={form.bio}
              onChange={set("bio")}
              rows={4}
              maxLength={PROFILE_LIMITS.bio}
              aria-invalid={error?.field === "bio" || undefined}
              className="input resize-y"
            />
            <span className="hint flex flex-wrap justify-between gap-2">
              <span>{isStaff ? t("account.aboutHintStaff") : t("account.aboutHintReader")}</span>
              <span className="tabular-nums" aria-live="polite">
                {t("account.charactersLeft", { count: PROFILE_LIMITS.bio - form.bio.length })}
              </span>
            </span>
            {fieldError("bio")}
          </label>

          <p className="text-sm text-ink-2">
            {t("account.shownAs")}: <span className="font-medium text-ink">{preview}</span>
          </p>

          {error && !error.field && (
            <p className="text-sm text-danger" role="alert">
              {error.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
              {saving ? t("common.saving") : t("common.save")}
            </button>
            <button type="button" onClick={cancel} className="btn btn-ghost btn-sm">
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
