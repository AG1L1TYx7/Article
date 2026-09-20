"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ToggleResult } from "./actions";

/**
 * Shared on/off control for likes, bookmarks and follows.
 *
 * Updates optimistically and rolls back if the server disagrees — these
 * are high-frequency, low-stakes clicks where waiting for a round trip
 * feels broken, but silently showing the wrong state would be worse.
 */
export function ToggleButton({
  initialActive,
  initialCount,
  activeLabel,
  inactiveLabel,
  action,
  disabled,
  disabledTitle,
}: {
  initialActive: boolean;
  initialCount?: number;
  activeLabel: string;
  inactiveLabel: string;
  action: () => Promise<ToggleResult>;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [active, setActive] = useState(initialActive);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Marks the control as interactive once React has hydrated. Clicking
  // server-rendered markup before hydration silently does nothing — the
  // handler isn't attached yet — which is invisible to a user (they just
  // click again) but makes automated tests flaky in a way that looks
  // like a backend bug. Written straight to the DOM node rather than held
  // in state: it never affects rendering, so it shouldn't cost a render.
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  function onClick() {
    const previousActive = active;
    const previousCount = count;

    setActive(!previousActive);
    if (typeof previousCount === "number") {
      setCount(previousCount + (previousActive ? -1 : 1));
    }
    setError(null);

    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setActive(previousActive);
        setCount(previousCount);
        setError(result.error ?? "That didn't work.");
        return;
      }
      if (typeof result.active === "boolean") setActive(result.active);
      if (typeof result.count === "number") setCount(result.count);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isPending}
        title={disabled ? disabledTitle : undefined}
        ref={buttonRef}
        aria-pressed={active}
        className={`rounded-md border px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          active
            ? "border-neutral-900 bg-neutral-900 text-white"
            : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
        }`}
      >
        {active ? activeLabel : inactiveLabel}
        {typeof count === "number" && count > 0 && <span className="ml-1 tabular-nums">{count}</span>}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
