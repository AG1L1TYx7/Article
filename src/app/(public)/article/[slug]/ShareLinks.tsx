"use client";

import { useState } from "react";
import { CheckIcon, LinkIcon } from "@/components/icons";

/**
 * The URL is passed in from the server rather than read from
 * window.location.
 *
 * Reading window.location during render looks like it works but doesn't:
 * the server renders an empty string, React reuses that markup when it
 * hydrates, and nothing re-renders afterwards — so every share link went
 * out with an empty url= parameter. Taking the canonical URL as a prop
 * also means the links are correct in the initial HTML, so they work for
 * crawlers and with JavaScript disabled.
 */
export function ShareLinks({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);

  const links = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}` },
    { label: "Email", href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}` },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <span className="mr-1 text-xs font-medium tracking-wide text-ink-3 uppercase">Share:</span>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-sm"
        >
          {l.label}
        </a>
      ))}
      <button
        type="button"
        onClick={async () => {
          try {
            // Rejects outright in a non-secure context or when the user
            // denies clipboard permission — don't leave an unhandled
            // rejection and a button that silently does nothing.
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt("Copy this link:", url);
          }
        }}
        className={`btn btn-ghost btn-sm gap-1.5 ${copied ? "text-ok" : ""}`}
      >
        {copied ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
        {copied ? "Copied!" : "Copy link"}
      </button>
    </div>
  );
}
