"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Shown in place of a page that threw. The message is deliberately
 * generic: the real error is logged on the server, and repeating it here
 * would hand a reader a stack trace they can't use — or an attacker a
 * hint they can.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the browser console for whoever is debugging; the
    // server already has the full error against the same digest.
    console.error(error);
  }, [error]);

  return (
    <main id="main-content" className="mx-auto flex max-w-lg flex-1 flex-col items-center px-6 pt-20 pb-16 text-center">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="headline mt-3 text-4xl">This page couldn&apos;t be shown.</h1>
      <p className="mt-4 text-ink-2">
        It&apos;s on our side, not yours. Trying again usually works; if it keeps happening, the
        front page is still there.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-xs text-ink-3">reference {error.digest}</p>
      )}
      <div className="mt-8 flex gap-3">
        <button onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Front page
        </Link>
      </div>
    </main>
  );
}
