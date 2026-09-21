"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markAllNotificationsRead } from "./actions";
import { CheckIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

export function MarkAllReadButton({ count }: { count: number }) {
  const router = useRouter();
  const { t, formatNumber } = useI18n();
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
      className="btn btn-secondary btn-sm gap-1.5"
    >
      <CheckIcon size={14} />
      {pending ? t("notifications.marking") : t("notifications.markAllRead", { count: formatNumber(count) })}
    </button>
  );
}
