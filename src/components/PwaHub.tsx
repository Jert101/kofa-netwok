"use client";

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)");
  if (mq.matches) return true;
  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PwaHub() {
  const [standalone, setStandalone] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPerm("unsupported");
      return;
    }
    setPerm(Notification.permission);
  }, []);

  const refreshSubscriptionState = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSubscribed(false);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    } catch {
      setSubscribed(false);
    }
  }, []);

  useEffect(() => {
    void refreshSubscriptionState();
  }, [refreshSubscriptionState, perm]);

  async function onInstall() {
    if (!deferred) return;
    setInstallBusy(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      setStandalone(isStandalone());
    } finally {
      setInstallBusy(false);
    }
  }

  async function enableNotifications() {
    setPushMsg(null);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushMsg("This browser does not support web push.");
      return;
    }
    const resKey = await fetch("/api/push/vapid-key");
    if (!resKey.ok) {
      setPushMsg("Notifications are not configured on the server yet.");
      return;
    }
    const { publicKey } = (await resKey.json()) as { publicKey?: string };
    if (!publicKey) {
      setPushMsg("Missing push configuration.");
      return;
    }

    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setPerm(permission);
      if (permission !== "granted") {
        setPushMsg("Permission was not granted.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyBytes = urlBase64ToUint8Array(publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes.buffer.slice(
            keyBytes.byteOffset,
            keyBytes.byteOffset + keyBytes.byteLength
          ) as ArrayBuffer,
        });
      }

      const j = sub.toJSON();
      if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) {
        setPushMsg("Could not read subscription keys.");
        return;
      }

      const save = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: j.endpoint,
          keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
        }),
        credentials: "same-origin",
      });
      if (!save.ok) {
        const err = (await save.json()) as { error?: string };
        setPushMsg(err.error ?? "Could not save subscription.");
        return;
      }
      setSubscribed(true);
      setPushMsg(
        "You will get notified for announcements (including officer posts), attendance updates, and high-mass server assignment updates (push only)."
      );
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPushBusy(false);
    }
  }

  async function disableNotifications() {
    setPushMsg(null);
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
          credentials: "same-origin",
        });
      }
      setSubscribed(false);
      setPushMsg("Notifications turned off for this device.");
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : "Could not unsubscribe.");
    } finally {
      setPushBusy(false);
    }
  }

  const showInstallUi = !standalone && (Boolean(deferred) || isIos());
  const canInstallChrome = Boolean(deferred);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-[60] flex h-12 min-h-12 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] shadow-lg"
        aria-expanded={open}
        aria-controls="pwa-hub-panel"
      >
        App
      </button>

      {open ? (
        <div
          id="pwa-hub-panel"
          className="fixed bottom-20 right-4 z-[60] w-[min(100vw-2rem,20rem)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
        >
          <p className="text-xs font-semibold text-[var(--accent)]">Install &amp; notifications</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Works even when you are signed out. Allow notifications when prompted.
          </p>

          {showInstallUi ? (
            <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
              <p className="text-xs font-medium text-[var(--text)]">Install app</p>
              {canInstallChrome ? (
                <button
                  type="button"
                  disabled={installBusy}
                  onClick={() => void onInstall()}
                  className="min-h-10 w-full rounded-xl bg-[var(--accent)] text-sm font-medium text-white disabled:opacity-40"
                >
                  {installBusy ? "Installing…" : "Install KofA AMS"}
                </button>
              ) : isIos() ? (
                <p className="text-xs text-[var(--muted)]">
                  On iPhone/iPad: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Web push on iOS
                  works after the app is installed from that screen (iOS 16.4+).
                </p>
              ) : (
                <p className="text-xs text-[var(--muted)]">
                  Use your browser menu: look for &quot;Install app&quot;, &quot;Add to Home screen&quot;, or similar.
                </p>
              )}
            </div>
          ) : null}

          <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-xs font-medium text-[var(--text)]">Push notifications</p>
            {perm === "unsupported" ? (
              <p className="text-xs text-[var(--muted)]">Notifications are not supported in this browser.</p>
            ) : subscribed ? (
              <button
                type="button"
                disabled={pushBusy}
                onClick={() => void disableNotifications()}
                className="min-h-10 w-full rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--text)] disabled:opacity-40"
              >
                {pushBusy ? "Working…" : "Turn off notifications"}
              </button>
            ) : (
              <button
                type="button"
                disabled={pushBusy || perm === "denied"}
                onClick={() => void enableNotifications()}
                className="min-h-10 w-full rounded-xl bg-[var(--accent)] text-sm font-medium text-white disabled:opacity-40"
              >
                {pushBusy ? "Enabling…" : "Enable notifications"}
              </button>
            )}
            {perm === "denied" && !subscribed ? (
              <p className="text-xs text-[var(--danger)]">
                Notifications are blocked. Enable them in your browser settings for this site.
              </p>
            ) : null}
            {pushMsg ? <p className="text-xs text-[var(--muted)]">{pushMsg}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
