"use client";

import { useCallback, useEffect, useState } from "react";
import { NOTIFY_TOPICS, type NotifyTopic } from "@/lib/notify/events";

type DeviceState = "unsupported" | "blocked" | "off" | "on";

const TOPIC_LABELS: Record<NotifyTopic, { label: string; help: string }> = {
  attendance: {
    label: "Roster changes",
    help: "When the servers or attendance for a day you can see changes.",
  },
  announcements: {
    label: "Announcements",
    help: "Parish announcements, including posts from the office and officer notices.",
  },
  reports: {
    label: "Reports",
    help: "Monthly reports waiting for review, and the decisions on them.",
  },
  liturgy: {
    label: "My assignments",
    help: "Reminders when you are assigned to serve, and the day before.",
  },
};

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * COM-4: what this device is doing, and the buttons to change it.
 *
 * Four states, named honestly: unsupported, blocked, off, on. The old hub only ever showed a button,
 * so a user who had denied the prompt and a user who had never been asked saw the same screen, and
 * the only way to tell them apart was to press the button and see what happened.
 *
 * The topic list is the reason this page exists rather than a toggle in the sidebar: turning off
 * roster pushes and keeping announcements has to be possible, and per the spec it applies to this
 * device only.
 */
export function NotificationSettings() {
  const [state, setState] = useState<DeviceState>("off");
  const [topics, setTopics] = useState<NotifyTopic[]>([...NOTIFY_TOPICS]);
  const [serverTopics, setServerTopics] = useState<NotifyTopic[] | null>(null);
  const [identityRecorded, setIdentityRecorded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      setState("off");
      return;
    }

    setState("on");
    try {
      const res = await fetch(`/api/push/topics?endpoint=${encodeURIComponent(sub.endpoint)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        // The browser still holds a subscription the server does not know about. Say so rather than
        // showing a topic list that would silently do nothing.
        setServerTopics(null);
        return;
      }
      const j = (await res.json()) as { topics?: string[]; identity_recorded?: boolean };
      const stored = (j.topics ?? []).filter((t): t is NotifyTopic =>
        (NOTIFY_TOPICS as readonly string[]).includes(t),
      );
      setServerTopics(stored.length > 0 ? stored : [...NOTIFY_TOPICS]);
      setTopics(stored.length > 0 ? stored : [...NOTIFY_TOPICS]);
      setIdentityRecorded(j.identity_recorded ?? null);
    } catch {
      setServerTopics(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function turnOn() {
    setError(null);
    setMsg(null);

    if (isIos() && !isInstalled()) {
      // Saying this up front beats a permission prompt that iOS silently refuses: the user would
      // conclude the app is broken.
      setError(
        "On iPhone and iPad, add this app to the Home Screen first: tap Share, then Add to Home Screen. Then open it from there and turn notifications on.",
      );
      return;
    }

    setBusy(true);
    try {
      const resKey = await fetch("/api/push/vapid-key");
      if (!resKey.ok) {
        setError("Notifications are not configured on the server yet.");
        return;
      }
      const { publicKey } = (await resKey.json()) as { publicKey?: string };
      if (!publicKey) {
        setError("Missing push configuration.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        setError(
          permission === "denied"
            ? "Notifications are blocked for this site. Re-enable them in your browser settings."
            : "Permission was not granted.",
        );
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
            keyBytes.byteOffset + keyBytes.byteLength,
          ) as ArrayBuffer,
        });
      }

      const j = sub.toJSON();
      if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) {
        setError("Could not read this device's subscription keys.");
        return;
      }

      const save = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        // The chosen topics come along, so subscribing and configuring are one action and the two
        // can never disagree.
        body: JSON.stringify({
          endpoint: j.endpoint,
          keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
          topics,
        }),
      });
      if (!save.ok) {
        const err = (await save.json()) as { error?: string };
        setError(err.error ?? "Could not save this device.");
        return;
      }

      setMsg("Notifications are on for this device.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ endpoint }),
        });
      }
      setState("off");
      setServerTopics(null);
      setMsg("Notifications are off for this device.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn notifications off.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setError("Turn notifications on first.");
        return;
      }
      const j = sub.toJSON();
      if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) {
        setError("Could not read this device's subscription keys.");
        return;
      }
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
      });
      const out = (await res.json()) as { ok?: boolean; error?: string };
      if (!out.ok) {
        setError(out.error ?? "The test did not arrive.");
        return;
      }
      setMsg("Test sent. It should appear within a few seconds.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTopics(next: NotifyTopic[]) {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setError("Turn notifications on first.");
        return;
      }
      const res = await fetch("/api/push/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ endpoint: sub.endpoint, topics: next }),
      });
      if (!res.ok) {
        const out = (await res.json()) as { error?: string };
        setError(out.error ?? "Could not save those topics.");
        return;
      }
      setTopics(next);
      setServerTopics(next);
      setMsg("Saved. This applies to this device only.");
    } catch {
      setError("Could not save those topics.");
    }
  }

  const on = state === "on";
  const stateText: Record<DeviceState, string> = {
    unsupported: "This browser cannot show web push notifications.",
    blocked: "Blocked. Your browser is refusing notifications for this site.",
    off: "Off. This device will not receive notifications.",
    on: "On. This device receives the topics selected below.",
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand)]">This device</h2>
        <p
          className={
            "mt-2 text-sm " +
            (state === "blocked" ? "text-[var(--danger)]" : "text-[var(--text-muted)]")
          }
        >
          {stateText[state]}
        </p>
        {identityRecorded === true ? null : on ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Signed in without a declared parish identity, so this device gets role messages only.
            Personal reminders need an identity on your member record.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void turnOn()}
            disabled={busy || on || state === "unsupported"}
            className="min-h-12 rounded-xl bg-[var(--brand)] px-4 font-medium text-white disabled:opacity-40"
          >
            Turn on notifications
          </button>
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={busy || !on}
            className="min-h-12 rounded-xl border border-[var(--border)] px-4 font-medium disabled:opacity-40"
          >
            Send a test
          </button>
          <button
            type="button"
            onClick={() => void turnOff()}
            disabled={busy || !on}
            className="min-h-12 rounded-xl border border-[var(--border)] px-4 font-medium disabled:opacity-40"
          >
            Turn off
          </button>
        </div>

        {state === "blocked" ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            To turn them back on: open your browser settings for this site, allow notifications, then
            reload this page. This page will not ask again, because a browser that has said no does
            not say yes to being asked.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand)]">What to notify me about</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Per device, not per account. Turning everything off still leaves the inbox in the app.
        </p>

        {serverTopics === null && on ? (
          <p className="mt-3 text-sm text-[var(--danger)]">
            This device has a subscription the server does not recognise. Turn notifications off and
            on again to fix it.
          </p>
        ) : null}

        <ul className="mt-3 space-y-3">
          {NOTIFY_TOPICS.map((t) => {
            const checked = topics.includes(t);
            return (
              <li key={t} className="flex items-start gap-3">
                <input
                  id={`topic-${t}`}
                  type="checkbox"
                  className="mt-1 size-5"
                  checked={checked}
                  disabled={!on || serverTopics === null}
                  onChange={() =>
                    void saveTopics(
                      checked ? topics.filter((x) => x !== t) : [...NOTIFY_TOPICS].filter(
                        (x) => x === t || topics.includes(x),
                      ),
                    )
                  }
                />
                <label htmlFor={`topic-${t}`} className="min-h-10">
                  <span className="block font-medium text-[var(--text)]">{TOPIC_LABELS[t].label}</span>
                  <span className="block text-sm text-[var(--text-muted)]">{TOPIC_LABELS[t].help}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {msg ? <p className="text-sm text-[var(--text-muted)]">{msg}</p> : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
