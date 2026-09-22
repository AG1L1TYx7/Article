"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { BookmarkIcon, HomeIcon, SearchIcon, UserIcon } from "./icons";

/**
 * Thumb-friendly navigation for phones: Home, Search, Saved, Account.
 *
 * Fixed to the bottom, where a thumb already is, with 44px targets and
 * the safe-area inset respected on phones with a home indicator. Hidden
 * from the medium breakpoint up, where the masthead's section bar does
 * the job. Saved and Account send a signed-out reader to log in, which
 * is the right answer rather than hiding the destinations.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { t } = useI18n();

  const items = [
    { href: "/", label: t("common.latest"), icon: HomeIcon, active: pathname === "/" },
    { href: "/search", label: t("common.search"), icon: SearchIcon, active: pathname.startsWith("/search") },
    { href: "/saved", label: t("header.saved"), icon: BookmarkIcon, active: pathname.startsWith("/saved") },
    { href: "/account", label: t("account.kicker"), icon: UserIcon, active: pathname.startsWith("/account") },
  ];

  return (
    <nav
      aria-label="Reader"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface/92 px-2 pt-1.5 backdrop-blur supports-[backdrop-filter]:bg-surface/85 md:hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)" }}
    >
      {items.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-semibold ${
            active ? "text-ink" : "text-ink-3"
          }`}
        >
          <Icon size={22} strokeWidth={active ? 2 : 1.5} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
