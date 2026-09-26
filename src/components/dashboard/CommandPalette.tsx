"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandIcon, SearchIcon } from "@/components/icons";

interface Command {
  label: string;
  hint: string;
  href: string;
  adminOnly?: boolean;
}

const COMMANDS: Command[] = [
  { label: "New article", hint: "Articles", href: "/dashboard/articles/new" },
  { label: "All articles", hint: "Articles", href: "/dashboard/articles" },
  { label: "Comment queue", hint: "Moderation", href: "/dashboard/comments" },
  { label: "Analytics", hint: "Newsroom", href: "/dashboard/analytics" },
  { label: "Two-factor authentication", hint: "Security", href: "/dashboard/mfa" },
  { label: "Overview", hint: "Newsroom", href: "/dashboard" },
  { label: "View the site", hint: "Public", href: "/" },
  { label: "Your profile", hint: "Public", href: "/account" },
  { label: "Account settings", hint: "Public", href: "/account/settings" },
  { label: "People and roles", hint: "Admin", href: "/dashboard/users", adminOnly: true },
  { label: "Categories", hint: "Admin", href: "/dashboard/categories", adminOnly: true },
  { label: "Audit log", hint: "Admin", href: "/dashboard/audit-log", adminOnly: true },
  { label: "Audit log: failed sign-ins", hint: "Admin", href: "/dashboard/audit-log?action=auth.login.failed", adminOnly: true },
  { label: "Settings", hint: "Admin", href: "/dashboard/settings", adminOnly: true },
];

/**
 * ⌘K / Ctrl+K: jump anywhere in the newsroom by typing a few letters.
 *
 * Navigation only, on purpose — it lists places, not actions, so
 * nothing destructive is one keystroke away. Admin-only destinations are
 * filtered out for moderators rather than shown and refused, which is
 * the same rule the sidebar follows.
 */
export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter((c) => !c.adminOnly || isAdmin).filter(
      (c) => !q || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)
    );
  }, [query, isAdmin]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setActive(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm hidden gap-2 md:inline-flex"
        aria-label="Jump to anything (Cmd or Ctrl + K)"
      >
        <SearchIcon size={14} />
        <span className="text-ink-3">Jump to…</span>
        <kbd className="ml-2 rounded border border-line-strong px-1.5 font-sans text-[10px] font-semibold text-ink-3">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[12vh]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-label="Jump to"
            className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <CommandIcon size={16} className="text-ink-3" />
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(results.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter" && results[active]) {
                    go(results[active].href);
                  }
                }}
                placeholder="Type where you want to go…"
                aria-label="Jump to"
                className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
              <kbd className="rounded border border-line-strong px-1.5 font-sans text-[10px] font-semibold text-ink-3">esc</kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
              {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-3">Nothing matches “{query}”.</li>}
              {results.map((c, i) => (
                <li key={c.href} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(c.href)}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${
                      i === active ? "bg-surface-2 text-ink" : "text-ink-2"
                    }`}
                  >
                    <span>{c.label}</span>
                    <span className="text-xs text-ink-3">{c.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
