"use client";

import { useEffect, useRef, useState } from "react";

// Cloudflare's widget API, as loaded by the script below.
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Renders the Turnstile challenge and hands the resulting token to the
 * parent form. Renders nothing at all when no site key is configured, so
 * local development and the e2e suite work without a Cloudflare account
 * (the server-side check in lib/turnstile.ts is skipped in exactly the
 * same case).
 *
 * Tokens are single-use and expire after five minutes, hence the reset on
 * expiry/error — without it a user who leaves the form open then submits
 * gets an unexplained rejection.
 */
export function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;

    let widgetId: string | undefined;
    let cancelled = false;
    const container = containerRef.current;

    function render() {
      if (cancelled || !window.turnstile || !container) return;
      widgetId = window.turnstile.render(container, {
        sitekey: SITE_KEY,
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => {
          onToken(null);
          setFailed(true);
        },
      });
    }

    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", render);
      } else {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.onload = render;
        script.onerror = () => setFailed(true);
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken]);

  if (!SITE_KEY) return null;

  return (
    <div>
      <div ref={containerRef} />
      {failed && (
        <p className="text-sm text-red-600">
          The anti-spam check couldn&apos;t load. Disable any blocker for this page and reload.
        </p>
      )}
    </div>
  );
}
