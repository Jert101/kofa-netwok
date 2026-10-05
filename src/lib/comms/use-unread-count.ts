"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * COM-2: one unread count for the whole shell.
 *
 * Polls every sixty seconds and refetches on window focus, which is what the spec asks for and the
 * smallest thing that makes a badge trustworthy: a page left open overnight has to notice the
 * seven-thirty reminders without being reloaded.
 *
 * The value is fetched by whoever mounts first and shared through `window`, because the sidebar and
 * the inbox page both want it and two pollers would double the requests for no benefit. If two mount
 * at once, the later one disposes of its own and reads the shared value, so there is no permanent
 * double poll.
 *
 * Marking something read dispatches `inbox:changed` rather than nobody refetching, so the badge
 * clears the moment the user reads the message instead of up to a minute later.
 */
export const UNREAD_CHANGED_EVENT = "inbox:changed";

/** Slow enough that six tabs do not hammer the server, fast enough to read as live on a phone. The
 *  header badge is now the (only) surface this feeds, so a parish member who taps it should see the
 *  count drop within a couple of beats, not after a full minute. */
export const UNREAD_POLL_MS = 15_000;

let subscribers = 0;
let sharedCount: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function publish(count: number) {
  sharedCount = count;
  window.dispatchEvent(new CustomEvent(UNREAD_CHANGED_EVENT, { detail: count }));
}

async function fetchUnread(): Promise<number | null> {
  try {
    const res = await fetch("/api/notifications/unread-count", {
      credentials: "same-origin",
      cache: "no-store",
    });
    // A 401 here means the session went away, which the router handles. Treating it as zero would
    // draw an empty bell and hide the fact that something is wrong.
    if (!res.ok) return null;
    const j = (await res.json()) as { unread?: number };
    return typeof j.unread === "number" ? j.unread : null;
  } catch {
    // Offline, or the tab was suspended mid-poll. The next tick tries again.
    return null;
  }
}

/** Ask the badge to refresh now. Called after reading, and by "mark all read". */
export function refreshUnread(): void {
  void fetchUnread().then((count) => {
    if (count !== null) publish(count);
  });
}

function startPolling() {
  if (timer) return;
  timer = setInterval(() => void refreshUnread(), UNREAD_POLL_MS);
  window.addEventListener("focus", refreshUnread);
  const onChanged = (e: Event) => {
    const detail = (e as CustomEvent<number>).detail;
    if (typeof detail === "number") sharedCount = detail;
  };
  window.addEventListener(UNREAD_CHANGED_EVENT, onChanged);
  stopHandlers.push(() => window.removeEventListener("focus", refreshUnread));
  stopHandlers.push(() => window.removeEventListener(UNREAD_CHANGED_EVENT, onChanged));
}

const stopHandlers: Array<() => void> = [];

export function useUnreadCount(): number | null {
  const [count, setCount] = useState<number | null>(sharedCount);

  const refresh = useCallback(() => void refreshUnread(), []);

  useEffect(() => {
    subscribers += 1;
    setCount(sharedCount);
    startPolling();
    void fetchUnread().then((next) => {
      if (next !== null) setCount(next);
    });

    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      setCount(typeof detail === "number" ? detail : null);
    };
    window.addEventListener(UNREAD_CHANGED_EVENT, onChanged);

    return () => {
      window.removeEventListener(UNREAD_CHANGED_EVENT, onChanged);
      subscribers -= 1;
      if (subscribers <= 0 && timer) {
        clearInterval(timer);
        timer = null;
        for (const stop of stopHandlers) stop();
        stopHandlers.length = 0;
      }
    };
  }, [refresh]);

  return count;
}

/**
 * Optimistically drop the badge without a round trip.
 *
 * Opening an item marks it read; waiting for the poll would leave a dot on something the user just
 * read. The server is still the authority and the next poll will correct us if it disagrees.
 */
export function markReadLocally() {
  if (sharedCount !== null && sharedCount > 0) publish(sharedCount - 1);
}
