"use client";

import { useEffect, useState } from "react";
import { BellIcon } from "@/components/icons";

/**
 * "Get breaking news alerts" — turns Web Push on or off for this browser.
 *
 * Renders nothing until it knows it can work: the browser must support
 * push, and the server must have VAPID keys configured (asked once via
 * /api/push/config, at runtime, so a bundle built elsewhere still reads
 * the right answer). A control that appears and then fails is worse than
 * no control.
 *
 * Nothing is asked of the reader until they click. Requesting notification
 * permission on page load is the fastest way to be blocked for good, and
 * browsers now suppress it anyway.
 */
type State =
  | "checking"
  | "unavailable"
  | "off"
  | "on"
  | "working"
  | "denied"
  | "error";

const SW_PATH = "/sw.js";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export function PushToggle({
  variant = "button",
}: {
  /** "button" is a pill; "row" fits a settings list with a description. */
  variant?: "button" | "row";
}) {
  const [state, setState] = useState<State>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supported()) return setState("unavailable");
      try {
        const res = await fetch("/api/push/config", { cache: "no-store" });
        const config = (await res.json()) as { enabled: boolean; publicKey: string | null };
        if (cancelled) return;
        if (!config.enabled || !config.publicKey) return setState("unavailable");
        setPublicKey(config.publicKey);
        if (Notification.permission === "denied") return setState("denied");
        const existing = await currentSubscription();
        if (!cancelled) setState(existing ? "on" : "off");
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!publicKey) return;
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");

      const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      setState("on");
    } catch {
      setState("error");
    }
  }

  async function disable() {
    setState("working");
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setState("error");
    }
  }

  if (state === "checking" || state === "unavailable") return null;

  const on = state === "on";
  const busy = state === "working";
  const label = on ? "Breaking news alerts on" : "Get breaking news alerts";

  const button = (
    <button
      type="button"
      onClick={on ? disable : enable}
      disabled={busy || state === "denied"}
      aria-pressed={on}
      data-push-toggle
      className={`btn rounded-full ${variant === "button" ? "btn-sm" : ""} ${
        on ? "border-ink bg-ink text-paper hover:bg-ink/85 [&_svg]:fill-current" : "btn-secondary"
      }`}
    >
      <BellIcon size={variant === "button" ? 14 : 16} />
      {busy ? "One moment…" : label}
    </button>
  );

  const note =
    state === "denied"
      ? "Notifications are blocked for this site in your browser settings."
      : state === "error"
        ? "That didn't work. Try again in a moment."
        : on
          ? "This device is alerted when a breaking story goes live. Turn it off any time."
          : "A notification on this device the moment a breaking story goes live. No account needed.";

  if (variant === "button") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {button}
        {(state === "denied" || state === "error") && (
          <span className="text-xs text-ink-3" role="status">
            {note}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-md text-sm text-ink-2" role="status">
        {note}
      </p>
      {button}
    </div>
  );
}
