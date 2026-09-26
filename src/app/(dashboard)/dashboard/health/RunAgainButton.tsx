"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the page on the server, which measures everything again. */
export function RunAgainButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" onClick={() => startTransition(() => router.refresh())} disabled={pending} className="btn btn-secondary btn-sm">
      {pending ? "Checking…" : "Check again"}
    </button>
  );
}
