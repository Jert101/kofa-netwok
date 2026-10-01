/**
 * ATT-6: a retry queue for roster taps that fail because the network did.
 *
 * This is not offline mode and deliberately cannot become one. The page has to be
 * loaded first, because the roster it edits comes from the server. What it handles
 * is the gap in the middle: the parish wifi drops between taps, and every tap after
 * that would otherwise be silently lost. Attendance that vanishes quietly is worse
 * than attendance that was never entered, because nobody goes looking for it.
 *
 * Three rules shape everything here:
 *
 * Order is preserved. Taps are kept in the order they were made, so a secretary who
 * taps one member on, then off, does not get the two applied in the other order.
 *
 * A rejection is not a retry. When the server refuses a change, keeping it would
 * replay the refusal forever. Those entries are dropped and reported by name.
 *
 * The queue is capped. 200 entries is roughly four Masses of tapping, past which
 * something is wrong and the queue should not grow without bound in a browser.
 */

export const MAX_QUEUE_ENTRIES = 200;

export type QueueEntry = {
  /** Monotonic, so order survives a reload even if two taps share a timestamp. */
  seq: number;
  memberId: string;
  memberName: string;
  present: boolean;
  queuedAt: string;
};

export type EnqueueResult = { queue: QueueEntry[]; dropped: QueueEntry[] };

/**
 * Adds entries, keeping order and enforcing the cap.
 *
 * When the queue is full the *oldest* entries are dropped, not the new ones. The new
 * ones are the ones the secretary just made and can see on screen; the old ones have
 * been sitting there long enough that re-checking them is no longer the priority.
 * Dropped entries are returned so the caller can tell the secretary, rather than
 * letting them discover a missing mark days later.
 */
export function enqueue(queue: QueueEntry[], entries: Omit<QueueEntry, "seq" | "queuedAt">[], now: string): EnqueueResult {
  const seq = queue.reduce((max, e) => Math.max(max, e.seq), 0);
  const added = entries.map((entry, index) => ({
    ...entry,
    seq: seq + index + 1,
    queuedAt: now,
  }));

  const combined = [...queue, ...added];
  if (combined.length <= MAX_QUEUE_ENTRIES) {
    return { queue: combined, dropped: [] };
  }

  const overflow = combined.length - MAX_QUEUE_ENTRIES;
  return { queue: combined.slice(overflow), dropped: combined.slice(0, overflow) };
}

/** Oldest first. The flush order. */
export function inOrder(queue: QueueEntry[]): QueueEntry[] {
  return [...queue].sort((a, b) => a.seq - b.seq);
}

/** Which members are waiting, and how many changes that is, for the status pill. */
export function queueSummary(queue: QueueEntry[]): {
  changes: number;
  members: number;
  label: string;
} {
  const changes = queue.length;
  const members = new Set(queue.map((e) => e.memberId)).size;
  return {
    changes,
    members,
    label: `Offline — ${changes} change${changes === 1 ? "" : "s"} waiting`,
  };
}

/**
 * Works out what to keep after a flush.
 *
 * `networkFailed` entries go back for another attempt. `rejected` entries are gone:
 * the server said no, and the response is passed on so the caller can name the
 * member. Anything else is treated as accepted, because the safest reading of an
 * unrecognised outcome is that the tap landed.
 */
export function settle(
  queue: QueueEntry[],
  results: Map<number, { ok: true } | { ok: false; reason: "network" | "rejected"; message?: string }>,
): { remaining: QueueEntry[]; rejected: { entry: QueueEntry; message?: string }[] } {
  const remaining: QueueEntry[] = [];
  const rejected: { entry: QueueEntry; message?: string }[] = [];

  for (const entry of inOrder(queue)) {
    const result = results.get(entry.seq);
    if (!result) {
      // No answer for this entry. Keep it, so a partial flush cannot lose a tap.
      remaining.push(entry);
      continue;
    }
    if (result.ok) continue;
    if (result.reason === "network") {
      remaining.push(entry);
      continue;
    }
    rejected.push({ entry, message: result.message });
  }

  return { remaining, rejected };
}

/**
 * Collapses repeated taps on the same member down to the latest intention.
 *
 * Flushing all 200 would work, but tapping a member on then off twice with no
 * network sends four changes and needs two. Collapsing to the last intent per member
 * is safe precisely because `records/set` is idempotent: the final state is what
 * matters, and the intermediate states were never true.
 */
export function collapse(queue: QueueEntry[]): QueueEntry[] {
  const latest = new Map<string, QueueEntry>();
  for (const entry of inOrder(queue)) {
    latest.set(entry.memberId, entry);
  }
  return [...latest.values()].sort((a, b) => a.seq - b.seq);
}
