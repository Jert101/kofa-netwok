"use client";

/**
 * ATT-6: the queue, persisted so it survives a reload.
 *
 * Stored in localStorage rather than held in React state because the failure it
 * exists for is losing the page's connection — and a refresh or an accidental
 * navigation is a second way to lose the same taps.
 *
 * Deliberately not IndexedDB and deliberately not a service worker: those would make
 * this look like offline mode, which the spec rules out. The page still has to be
 * loaded from the network first. This is a holding pen for a few seconds of bad
 * wifi, not a sync engine.
 *
 * Entries carry their session id, so switching between two open session screens
 * cannot flush one session's taps into the other.
 */

import {
  collapse,
  enqueue,
  settle,
  type QueueEntry,
} from "@/lib/attendance/retry-queue";
import { messageOf, readEnvelope } from "@/lib/api/client";

const KEY = "kofa.attendance.retry.v1";

export type StoredEntry = QueueEntry & { session_id: string };

function isEntry(value: unknown): value is StoredEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.memberId === "string" &&
    typeof e.memberName === "string" &&
    typeof e.present === "boolean" &&
    typeof e.seq === "number" &&
    typeof e.session_id === "string"
  );
}

export function readAll(): StoredEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    // Anything malformed is dropped rather than repaired. A queue that half-parsed
    // could send a change for a member id that does not exist, which is worse than
    // asking the secretary to retap two names.
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function write(queue: StoredEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    if (!queue.length) {
      window.localStorage.removeItem(KEY);
      return;
    }
    window.localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Storage full or blocked. The queue still works for this page view; it just will
    // not survive a reload, which is the lesser failure.
  }
}

export type ChangeResult =
  | { ok: true }
  | { ok: false; reason: "network" | "rejected"; message?: string };

/**
 * Sends one change for one member.
 *
 * Never throws. The caller's job is to keep tapping, not to handle errors, and a
 * rejected fetch here is the normal case the queue is designed around.
 */
export async function sendPresence(
  sessionId: string,
  memberId: string,
  present: boolean,
): Promise<ChangeResult> {
  try {
    const res = await fetch(`/api/attendance/session/${sessionId}/records/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ changes: [{ member_id: memberId, present }] }),
    });

    if (res.ok) return { ok: true };

    const env = await readEnvelope(res);

    // A 4xx means the server refuses for a reason that will still be true in ten
    // seconds: the month is locked, the Mass is in the future, the member is gone.
    // Retrying would just refill the queue with a change that can never land.
    //
    // 429 is the exception: that is "slow down", not "no".
    if (res.status === 429) return { ok: false, reason: "network" };
    if (res.status >= 400 && res.status < 500) {
      // The text is at error.message. Reading `error` itself handed an object to a field typed as
      // a string, so the rejection toast said "[object Object]" instead of why it was refused.
      return { ok: false, reason: "rejected", message: messageOf(env, "The server refused that change.") };
    }

    return { ok: false, reason: "network" };
  } catch {
    // fetch only rejects on a real network failure, which is exactly the case the
    // queue exists for.
    return { ok: false, reason: "network" };
  }
}

/**
 * Adds a change to the queue for a session, returning any entries pushed out by the
 * cap.
 *
 * Sessions are queued independently so opening a second Mass does not interleave its
 * changes with the first one's.
 */
export function queueChange(
  sessionId: string,
  memberId: string,
  memberName: string,
  present: boolean,
): { dropped: QueueEntry[] } {
  const all = readAll();
  const others = all.filter((e) => e.session_id !== sessionId);
  const mine = all.filter((e) => e.session_id === sessionId);

  const { queue, dropped } = enqueue(mine, [{ memberId, memberName, present }], new Date().toISOString());

  const stamped: StoredEntry[] = queue.map((e) => ({ ...e, session_id: sessionId }));
  write([...stamped, ...others]);
  return { dropped };
}

export function queueFor(sessionId: string): StoredEntry[] {
  return readAll().filter((e) => e.session_id === sessionId);
}

/**
 * Flushes a session's queue in order.
 *
 * Collapsed first, so tapping someone on then off while offline sends one "off"
 * rather than two changes. That is only safe because `records/set` is idempotent:
 * the final state is what matters and the intermediate state was never on screen.
 */
export async function flushQueue(
  sessionId: string,
  nameFor: (memberId: string) => string,
): Promise<{ rejected: { memberName: string; message?: string }[]; remaining: number }> {
  const pending = queueFor(sessionId);
  if (!pending.length) return { rejected: [], remaining: 0 };

  // Collapse first, so tapping someone on then off while offline sends one "off"
  // instead of two changes. Safe precisely because records/set is idempotent.
  const toSend = collapse(pending);

  const results = new Map<
    number,
    { ok: true } | { ok: false; reason: "network" | "rejected"; message?: string }
  >();

  for (const entry of toSend) {
    results.set(entry.seq, await sendPresence(sessionId, entry.memberId, entry.present));
  }

  const { remaining, rejected } = settle(toSend, results);

  // Only the collapsed list was sent, so only its survivors go back into storage.
  // The original per-tap entries are dropped: their intent is already represented.
  const others = readAll().filter((e) => e.session_id !== sessionId);
  write([...others, ...remaining.map((e) => ({ ...e, session_id: sessionId }))]);

  return {
    rejected: rejected.map((r) => ({
      memberName: r.entry.memberName || nameFor(r.entry.memberId),
      message: r.message,
    })),
    remaining: remaining.length,
  };
}

/** Called when the tab comes back or the connection returns. */
export function subscribeToConnection(onOnline: () => void): () => void {
  window.addEventListener("online", onOnline);
  return () => window.removeEventListener("online", onOnline);
}
