"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartIcon,
  HomeIcon,
  ListIcon,
  MessageIcon,
  PenIcon,
  ShieldIcon,
  TagIcon,
  UsersIcon,
} from "@/components/icons";

interface Item {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  adminOnly?: boolean;
  /** Match on exactly this path rather than any path beneath it. */
  exact?: boolean;
}

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Overview", icon: HomeIcon, exact: true },
  { href: "/dashboard/articles", label: "Articles", icon: PenIcon },
  { href: "/dashboard/comments", label: "Comment moderation", icon: MessageIcon },
  { href: "/dashboard/analytics", label: "Analytics", icon: ChartIcon },
  { href: "/dashboard/categories", label: "Categories", icon: TagIcon, adminOnly: true },
  { href: "/dashboard/users", label: "People", icon: UsersIcon, adminOnly: true },
  { href: "/dashboard/audit-log", label: "Audit log", icon: ListIcon, adminOnly: true },
];

export function DashboardNav({ role, mfaEnabled }: { role?: string; mfaEnabled: boolean }) {
  const pathname = usePathname();
  const isAdmin = role === "ADMIN";

  const items: Item[] = [
    ...ITEMS.filter((item) => !item.adminOnly || isAdmin),
    {
      href: "/dashboard/mfa",
      label: mfaEnabled ? "Manage two-factor authentication" : "Set up two-factor authentication",
      icon: ShieldIcon,
    },
  ];

  return (
    <nav
      aria-label="Newsroom"
      className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] md:flex-col md:px-3 md:pb-0 [&::-webkit-scrollbar]:hidden"
    >
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-ink text-paper"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="whitespace-nowrap md:whitespace-normal">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
