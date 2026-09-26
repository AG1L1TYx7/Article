"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartIcon,
  HomeIcon,
  ListIcon,
  LockIcon,
  MessageIcon,
  PenIcon,
  FlagIcon,
  HeartIcon,
  ShieldIcon,
  SlidersIcon,
  TagIcon,
  UsersIcon,
} from "@/components/icons";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/t";

interface Item {
  href: string;
  label: MessageKey;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  adminOnly?: boolean;
  /** Match on exactly this path rather than any path beneath it. */
  exact?: boolean;
}

const ITEMS: Item[] = [
  { href: "/dashboard", label: "dashboard.overview", icon: HomeIcon, exact: true },
  { href: "/dashboard/articles", label: "dashboard.articles", icon: PenIcon },
  { href: "/dashboard/comments", label: "dashboard.commentModeration", icon: MessageIcon },
  { href: "/dashboard/analytics", label: "dashboard.analytics", icon: ChartIcon },
  { href: "/dashboard/categories", label: "dashboard.categories", icon: TagIcon, adminOnly: true },
  { href: "/dashboard/users", label: "dashboard.people", icon: UsersIcon, adminOnly: true },
  { href: "/dashboard/issues", label: "dashboard.issues", icon: FlagIcon },
  { href: "/dashboard/contributions", label: "dashboard.contributions", icon: HeartIcon },
  { href: "/dashboard/roles", label: "dashboard.roles", icon: ShieldIcon, adminOnly: true },
  { href: "/dashboard/audit-log", label: "dashboard.auditLog", icon: ListIcon, adminOnly: true },
  { href: "/dashboard/settings", label: "dashboard.settings", icon: SlidersIcon, adminOnly: true },
];

const MFA_HREF = "/dashboard/mfa";

/**
 * @param locked  True for an admin who has not yet enabled two-factor
 *   authentication. proxy.ts sends every other dashboard URL back to the
 *   MFA page for them, so the links are shown as locked rather than
 *   letting them click and silently land where they started.
 */
export function DashboardNav({
  role,
  mfaEnabled,
  locked = false,
}: {
  role?: string;
  mfaEnabled: boolean;
  locked?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const isAdmin = role === "ADMIN";

  const items: Item[] = [
    ...ITEMS.filter((item) => !item.adminOnly || isAdmin),
    {
      href: MFA_HREF,
      label: mfaEnabled ? "dashboard.manageTwoFactor" : "dashboard.setUpTwoFactor",
      icon: ShieldIcon,
    },
  ];

  return (
    <nav
      aria-label={t("dashboard.newsroom")}
      className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] md:flex-col md:px-3 md:pb-0 [&::-webkit-scrollbar]:hidden"
    >
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
        const isLocked = locked && href !== MFA_HREF;
        const classes = `flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
          active ? "bg-ink text-paper" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
        }`;

        if (isLocked) {
          return (
            <span
              key={href}
              aria-disabled="true"
              title={t("dashboard.setUpTwoFactorFirst")}
              className={`${classes} cursor-not-allowed opacity-50 hover:bg-transparent hover:text-ink-2`}
            >
              <LockIcon size={16} className="shrink-0" />
              <span className="whitespace-nowrap md:whitespace-normal">{t(label)}</span>
            </span>
          );
        }

        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={classes}>
            <Icon size={16} className="shrink-0" />
            <span className="whitespace-nowrap md:whitespace-normal">{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
