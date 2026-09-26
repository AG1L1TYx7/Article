import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { EmailVerifyBanner } from "@/app/(dashboard)/dashboard/EmailVerifyBanner";
import { PenIcon, ShieldIcon, SlidersIcon } from "@/components/icons";
import { initials } from "@/lib/format";
import { one } from "@/lib/searchParams";
import { getI18n, getLocale } from "@/i18n/server";
import { LOCALE_NAMES } from "@/i18n/config";
import type { MessageKey } from "@/i18n/t";

export const metadata: Metadata = {
  title: "Your profile",
  robots: { index: false, follow: false },
};

/**
 * The signed-in person's own profile: who they are on the site and what
 * they have done here. Every setting lives on /account/settings.
 *
 * Only ever the viewer's own profile. Staff have a public author page
 * (/author/[handle]); a reader has no public page on purpose, because it
 * would show that the account exists and what they have commented on.
 */
const ROLE_LABEL: Record<string, MessageKey> = {
  READER: "account.roleReader",
  MODERATOR: "account.roleModerator",
  ADMIN: "account.roleAdmin",
};

const TABS = ["comments", "saved", "following"] as const;
type Tab = (typeof TABS)[number];
const LIST_LIMIT = 20;

export default async function ProfilePage(props: PageProps<"/account">) {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/account");
  const userId = session.user.id;

  const params = await props.searchParams;
  const requested = one(params.tab);
  const tab: Tab = (TABS as readonly string[]).includes(requested) ? (requested as Tab) : "comments";

  const { t, formatDate } = await getI18n();
  const locale = await getLocale();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      handle: true,
      email: true,
      bio: true,
      role: true,
      createdAt: true,
      emailVerifiedAt: true,
      mfaEnabled: true,
      firstName: true,
      preferredName: true,
      district: { select: { name: true, nameNe: true } },
      _count: {
        select: {
          bookmarks: { where: { article: { status: "PUBLISHED" } } },
          comments: { where: { status: { not: "DELETED" } } },
          follows: true,
          articles: { where: { status: "PUBLISHED" } },
        },
      },
    },
  });
  if (!user) redirect("/login");

  const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";
  const district = user.district ? (locale === "ne" ? user.district.nameNe : user.district.name) : null;

  // Only the tab being shown is fetched.
  const comments =
    tab === "comments"
      ? await db.comment.findMany({
          where: { userId, status: { not: "DELETED" } },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          select: {
            id: true,
            body: true,
            status: true,
            anonymous: true,
            createdAt: true,
            article: { select: { title: true, slug: true } },
            _count: { select: { replies: true, reactions: true } },
          },
        })
      : [];
  const saved =
    tab === "saved"
      ? await db.bookmark.findMany({
          // An article unpublished since it was saved would be a dead link.
          where: { userId, article: { status: "PUBLISHED" } },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          select: {
            createdAt: true,
            article: {
              select: { title: true, slug: true, anonymous: true, author: { select: { name: true } }, category: { select: { name: true } } },
            },
          },
        })
      : [];
  const following =
    tab === "following"
      ? await db.follow.findMany({
          where: { followerId: userId },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            author: { select: { name: true, handle: true } },
            category: { select: { name: true, slug: true } },
          },
        })
      : [];

  const counts: { key: Tab | "articles"; value: number; label: MessageKey }[] = [
    { key: "saved", value: user._count.bookmarks, label: "account.statSaved" },
    { key: "comments", value: user._count.comments, label: "account.statComments" },
    { key: "following", value: user._count.follows, label: "account.statFollowing" },
    ...(isStaff ? [{ key: "articles" as const, value: user._count.articles, label: "account.statArticles" as MessageKey }] : []),
  ];

  const checklist: { done: boolean; label: MessageKey; href: string }[] = [
    { done: !!(user.firstName || user.preferredName), label: "account.checkName", href: "/account/settings#personal" },
    { done: !!user.bio, label: "account.checkBio", href: "/account/settings#personal" },
    { done: !!user.emailVerifiedAt, label: "account.checkEmail", href: "/account/settings#account" },
    { done: user.mfaEnabled, label: "account.checkTwoFactor", href: "/account/settings#security" },
    { done: !!user.district, label: "account.checkDistrict", href: "/account/settings#district" },
  ];
  const remaining = checklist.filter((c) => !c.done);

  return (
    <main id="main-content" className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6">
      {!user.emailVerifiedAt && (
        <div className="mb-6">
          <EmailVerifyBanner email={user.email} />
        </div>
      )}

      {/* ---------------- Who you are ---------------- */}
      <header className="grid gap-5 border-b border-line pb-6 sm:grid-cols-[auto_1fr] sm:gap-6" aria-labelledby="profile-name">
        <span className="avatar h-20 w-20 bg-accent-soft font-display text-2xl text-accent ring-0 sm:h-24 sm:w-24 sm:text-3xl" aria-hidden>
          {initials(user.name)}
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="kicker">{t("account.profileKicker")}</p>
          <h1 id="profile-name" className="headline text-4xl break-words">
            {user.name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-3">
            <span>@{user.handle}</span>
            <span className={`pill ${isStaff ? "pill-danger" : "pill-neutral"}`}>{t(ROLE_LABEL[user.role] ?? "account.roleReader")}</span>
            {district && <span>{t("account.districtOf", { district })}</span>}
            <span>{t("account.memberSince", { date: formatDate(user.createdAt) })}</span>
          </p>
          {user.bio ? (
            <p className="mt-1 max-w-[62ch] font-serif text-[17px] leading-relaxed whitespace-pre-line text-ink-2">{user.bio}</p>
          ) : (
            <Link href="/account/settings#personal" className="text-link w-fit text-sm">
              {t("account.addBio")}
            </Link>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href="/account/settings#personal" className="btn btn-primary btn-sm gap-1.5">
              <PenIcon size={14} /> {t("account.editProfile")}
            </Link>
            <Link href="/account/settings" className="btn btn-secondary btn-sm gap-1.5">
              <SlidersIcon size={14} /> {t("account.openSettings")}
            </Link>
            {isStaff && (
              <Link href={`/author/${user.handle}`} className="btn btn-ghost btn-sm">
                {t("account.viewAuthorPage")}
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ---------------- In numbers ---------------- */}
      <dl className={`grid grid-cols-2 border-b border-line ${isStaff ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {counts.map((c, i) => (
          <div key={c.key} className={`flex flex-col-reverse gap-0.5 py-4 ${i % 2 === 1 ? "pl-4 border-l border-line" : ""} sm:pl-4 sm:first:pl-0 ${i > 0 ? "sm:border-l sm:border-line" : ""}`}>
            <dt className="text-xs text-ink-3">{t(c.label)}</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{c.value.toLocaleString(locale === "ne" ? "ne-NP" : "en")}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
        {/* ---------------- What you've done ---------------- */}
        <section aria-label={t("account.activity")}>
          <nav className="flex gap-6 overflow-x-auto border-b border-line" aria-label={t("account.activity")}>
            {TABS.map((key) => {
              const active = key === tab;
              const label: MessageKey = key === "comments" ? "account.tabComments" : key === "saved" ? "account.tabSaved" : "account.tabFollowing";
              const count = key === "comments" ? user._count.comments : key === "saved" ? user._count.bookmarks : user._count.follows;
              return (
                <Link
                  key={key}
                  href={key === "comments" ? "/account" : `/account?tab=${key}`}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px border-b-2 py-3 text-sm font-medium whitespace-nowrap ${active ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
                >
                  {t(label)} <span className="ml-0.5 text-xs text-ink-3 tabular-nums">{count}</span>
                </Link>
              );
            })}
          </nav>

          {tab === "comments" &&
            (comments.length ? (
              <ul className="divide-y divide-line">
                {comments.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1.5 py-4">
                    <p className="text-xs text-ink-3">
                      {t("account.commentOn")}{" "}
                      <Link href={`/article/${c.article.slug}#comment-${c.id}`} className="font-medium text-ink-2 hover:text-ink">
                        {c.article.title}
                      </Link>{" "}
                      · {formatDate(c.createdAt)}
                    </p>
                    <p className="line-clamp-4 font-serif text-[16px] leading-relaxed whitespace-pre-line">{c.body}</p>
                    <p className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
                      {c.status === "PENDING" && <span className="pill pill-warn">{t("account.commentPending")}</span>}
                      {c.status === "HIDDEN" && <span className="pill pill-neutral">{t("account.commentHidden")}</span>}
                      {c.anonymous && <span>{t("account.anonymousComment")}</span>}
                      <span className="tabular-nums">♥ {c._count.reactions}</span>
                      <span className="tabular-nums">↩ {c._count.replies}</span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-sm text-ink-3">{t("account.noComments")}</p>
            ))}

          {tab === "saved" &&
            (saved.length ? (
              <>
                <ul className="divide-y divide-line">
                  {saved.map((b) => (
                    <li key={b.article.slug} className="flex flex-col gap-1 py-4">
                      {b.article.category && <p className="kicker text-accent">{b.article.category.name}</p>}
                      <Link href={`/article/${b.article.slug}`} className="headline text-lg leading-snug hover:underline">
                        {b.article.title}
                      </Link>
                      <p className="text-xs text-ink-3">
                        {b.article.anonymous ? "" : `${b.article.author.name} · `}
                        {formatDate(b.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
                {user._count.bookmarks > LIST_LIMIT && (
                  <Link href="/saved" className="text-link mt-3 inline-block text-sm">
                    {t("account.seeAll")}
                  </Link>
                )}
              </>
            ) : (
              <p className="py-8 text-sm text-ink-3">{t("account.noSaved")}</p>
            ))}

          {tab === "following" &&
            (following.length ? (
              <ul className="divide-y divide-line">
                {following.map((f) => {
                  const href = f.author ? `/author/${f.author.handle}` : f.category ? `/category/${f.category.slug}` : null;
                  const name = f.author?.name ?? f.category?.name;
                  if (!href || !name) return null;
                  return (
                    <li key={f.id} className="flex items-center gap-3 py-3">
                      <span className="avatar h-10 w-10 text-xs" aria-hidden>
                        {f.author ? initials(f.author.name) : "§"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Link href={href} className="block font-medium hover:underline">
                          {name}
                        </Link>
                        <span className="text-xs text-ink-3">{f.author ? t("account.writerLabel") : t("account.sectionLabel")}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-8 text-sm text-ink-3">{t("account.noFollowing")}</p>
            ))}
        </section>

        {/* ---------------- Beside it ---------------- */}
        <aside className="flex flex-col gap-4 lg:pt-4" aria-label={t("account.accountBox")}>
          <section className="card p-4" aria-labelledby="account-box">
            <h2 id="account-box" className="kicker">
              {t("account.accountBox")}
            </h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">{t("common.email")}</dt>
                <dd className="min-w-0 truncate text-right" title={user.email}>
                  {user.email}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">{t("account.twoFactor")}</dt>
                <dd>
                  <span className={`pill ${user.mfaEnabled ? "pill-ok" : "pill-neutral"}`}>
                    <ShieldIcon size={11} /> {user.mfaEnabled ? t("account.twoFactorOn") : t("account.twoFactorOff")}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">{t("account.language")}</dt>
                <dd>{LOCALE_NAMES[locale]}</dd>
              </div>
            </dl>
            <Link href="/account/settings" className="text-link mt-3 inline-block text-sm font-medium">
              {t("account.allSettings")} →
            </Link>
          </section>

          <section className="card p-4" aria-labelledby="checklist-heading">
            <h2 id="checklist-heading" className="kicker">
              {t("account.finishProfile")}
            </h2>
            {remaining.length === 0 ? (
              <p className="mt-3 text-sm text-ok">{t("account.profileComplete")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    <span aria-hidden className={c.done ? "text-ok" : "text-ink-3"}>
                      {c.done ? "✓" : "○"}
                    </span>
                    {c.done ? (
                      <span className="text-ink-3 line-through decoration-ink-3/40">{t(c.label)}</span>
                    ) : (
                      <Link href={c.href} className="hover:underline">
                        {t(c.label)}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
