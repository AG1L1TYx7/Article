"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * A button that runs a server action and tells the person what happened.
 *
 * The newsroom used to submit these through `<form action>` with the
 * result thrown away: deleting a category that still had articles, or
 * approving a comment that had just been deleted by its author, silently
 * did nothing. Every action already returns `{ ok, error }`; this shows
 * it.
 *
 * Takes the server action and its arguments separately rather than a
 * closure: a server component may hand a Client Component a reference
 * to a "use server" function, but not an arrow function wrapping one —
 * React refuses at render time ("Functions cannot be passed directly to
 * Client Components"). Caught the first time this was written.
 *
 * `confirm` asks first, for anything that cannot be undone from the
 * interface. Pending state disables the button rather than hiding it,
 * so the layout never jumps.
 */
export function ActionButton<A extends unknown[]>({
  action,
  args,
  children,
  className = "btn btn-sm btn-ghost",
  pendingLabel,
  confirm,
  disabled,
  title,
}: {
  action: (...args: A) => Promise<{ ok: boolean; error?: string }>;
  args: A;
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  /** A question to ask before running; the action only runs on OK. */
  confirm?: string;
  disabled?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    startTransition(async () => {
      const result = await action(...args);
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={run} disabled={disabled || isPending} title={title} className={className}>
        {isPending && pendingLabel ? pendingLabel : children}
      </button>
      {error && (
        <span role="alert" className="max-w-xs text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
