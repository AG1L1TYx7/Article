"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markAllNotificationsRead } from "./actions";

export function MarkAllReadButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await markAllNotificationsRead();
        setPending(false);
        router.refresh();
      }}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50"
    >
      {pending ? "Marking…" : `Mark ${count} as read`}
    </button>
  );
}
