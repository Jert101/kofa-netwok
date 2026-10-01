import { describe, expect, it } from "vitest";
import {
  collapse,
  enqueue,
  inOrder,
  queueSummary,
  settle,
  MAX_QUEUE_ENTRIES,
  type QueueEntry,
} from "./retry-queue";

const NOW = "2026-08-16T09:00:00.000Z";

function entry(seq: number, memberId: string, present: boolean): QueueEntry {
  return { seq, memberId, memberName: memberId.toUpperCase(), present, queuedAt: NOW };
}

describe("enqueue", () => {
  it("keeps entries in the order they were made", () => {
    const { queue } = enqueue([], [
      { memberId: "a", memberName: "Ada", present: true },
      { memberId: "b", memberName: "Ben", present: false },
      { memberId: "a", memberName: "Ada", present: false },
    ], NOW);

    expect(queue.map((e) => [e.memberId, e.present])).toEqual([
      ["a", true],
      ["b", false],
      ["a", false],
    ]);
  });

  it("numbers entries above whatever was already queued", () => {
    const first = enqueue([], [{ memberId: "a", memberName: "Ada", present: true }], NOW);
    const second = enqueue(first.queue, [{ memberId: "b", memberName: "Ben", present: true }], NOW);
    expect(second.queue.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("stamps the queue time", () => {
    const { queue } = enqueue([], [{ memberId: "a", memberName: "Ada", present: true }], NOW);
    expect(queue[0].queuedAt).toBe(NOW);
  });

  it("caps the queue and drops the oldest entries", () => {
    const full = Array.from({ length: MAX_QUEUE_ENTRIES }, (_, i) =>
      entry(i + 1, `m${i + 1}`, true),
    );

    const { queue, dropped } = enqueue(full, [{ memberId: "new", memberName: "New", present: true }], NOW);

    expect(queue).toHaveLength(MAX_QUEUE_ENTRIES);
    expect(dropped).toHaveLength(1);
    // The new tap survives; the oldest waits go.
    expect(queue.some((e) => e.memberId === "new")).toBe(true);
    expect(queue.some((e) => e.memberId === "m1")).toBe(false);
  });

  it("reports every dropped entry, so nobody loses a mark silently", () => {
    const full = Array.from({ length: MAX_QUEUE_ENTRIES }, (_, i) => entry(i + 1, `m${i + 1}`, true));
    const { dropped } = enqueue(full, [
      { memberId: "n1", memberName: "N1", present: true },
      { memberId: "n2", memberName: "N2", present: true },
      { memberId: "n3", memberName: "N3", present: true },
    ], NOW);

    expect(dropped.map((e) => e.memberId)).toEqual(["m1", "m2", "m3"]);
  });

  it("handles adding several entries past the cap in one go", () => {
    const full = Array.from({ length: MAX_QUEUE_ENTRIES }, (_, i) => entry(i + 1, `m${i + 1}`, true));
    const { queue } = enqueue(full, [
      { memberId: "n1", memberName: "N1", present: true },
      { memberId: "n2", memberName: "N2", present: true },
    ], NOW);

    expect(queue).toHaveLength(MAX_QUEUE_ENTRIES);
    expect(queue.some((e) => e.memberId === "m1")).toBe(false);
    expect(queue.some((e) => e.memberId === "m2")).toBe(false);
  });
});

describe("inOrder", () => {
  it("sorts oldest first regardless of insertion order", () => {
    const sorted = inOrder([entry(3, "c", true), entry(1, "a", true), entry(2, "b", true)]);
    expect(sorted.map((e) => e.memberId)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const queue = [entry(2, "b", true), entry(1, "a", true)];
    inOrder(queue);
    expect(queue.map((e) => e.seq)).toEqual([2, 1]);
  });
});

describe("settle", () => {
  it("removes entries the server accepted", () => {
    const queue = [entry(1, "a", true), entry(2, "b", true)];
    const results = new Map([
      [1, { ok: true as const }],
      [2, { ok: true as const }],
    ]);
    expect(settle(queue, results)).toEqual({ remaining: [], rejected: [] });
  });

  it("keeps entries that failed on the network", () => {
    const queue = [entry(1, "a", true)];
    const results = new Map([[1, { ok: false as const, reason: "network" as const }]]);
    expect(settle(queue, results).remaining).toHaveLength(1);
  });

  it("drops a rejected entry instead of retrying it forever", () => {
    // Replaying a refusal would block everything behind it in the queue and never
    // clear, which looks like the app being broken.
    const queue = [entry(1, "a", true), entry(2, "b", true)];
    const results = new Map([
      [1, { ok: false as const, reason: "rejected" as const, message: "month is locked" }],
      [2, { ok: true as const }],
    ]);

    const { remaining, rejected } = settle(queue, results);
    expect(remaining).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].entry.memberId).toBe("a");
    expect(rejected[0].message).toBe("month is locked");
  });

  it("keeps entries with no answer, so a partial flush cannot lose a tap", () => {
    const queue = [entry(1, "a", true), entry(2, "b", true)];
    const results = new Map([[1, { ok: true as const }]]);
    const { remaining } = settle(queue, results);
    expect(remaining.map((e) => e.memberId)).toEqual(["b"]);
  });

  it("keeps the order of what it keeps", () => {
    const queue = [entry(3, "c", true), entry(1, "a", true), entry(2, "b", true)];
    // "a" is accepted, "b" and "c" hit the network.
    const results = new Map([
      [3, { ok: false as const, reason: "network" as const }],
      [1, { ok: true as const }],
      [2, { ok: false as const, reason: "network" as const }],
    ]);
    expect(settle(queue, results).remaining.map((e) => e.seq)).toEqual([2, 3]);
  });
});

describe("queueSummary", () => {
  it("counts changes and distinct members", () => {
    const summary = queueSummary([entry(1, "a", true), entry(2, "a", false), entry(3, "b", true)]);
    expect(summary.changes).toBe(3);
    expect(summary.members).toBe(2);
  });

  it("says one change in the singular", () => {
    expect(queueSummary([entry(1, "a", true)]).label).toBe("Offline — 1 change waiting");
  });

  it("pluralises correctly at zero and many", () => {
    expect(queueSummary([]).label).toBe("Offline — 0 changes waiting");
    expect(queueSummary([entry(1, "a", true), entry(2, "b", true)]).label).toBe(
      "Offline — 2 changes waiting",
    );
  });
});

describe("collapse", () => {
  it("keeps only the last intention per member", () => {
    // On then off: the server only needs to be told "off". Telling it "on" first is
    // harmless but pointless, and the queue exists because the network is slow.
    const collapsed = collapse([
      entry(1, "a", true),
      entry(2, "a", false),
      entry(3, "b", true),
    ]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed.find((e) => e.memberId === "a")?.present).toBe(false);
  });

  it("keeps the newest entry's sequence number", () => {
    const collapsed = collapse([entry(1, "a", true), entry(2, "a", false)]);
    expect(collapsed[0].seq).toBe(2);
  });

  it("stays in order", () => {
    const collapsed = collapse([entry(3, "c", true), entry(1, "a", true), entry(2, "b", true)]);
    expect(collapsed.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("handles an empty queue", () => {
    expect(collapse([])).toEqual([]);
  });

  it("never changes the final state of any member", () => {
    // The point of collapsing: whatever the secretary last saw on screen is what
    // the server ends up with.
    const queue = [
      entry(1, "a", true),
      entry(2, "b", true),
      entry(3, "a", false),
      entry(4, "c", true),
    ];
    const collapsed = collapse(queue);

    const finalState = new Map<string, boolean>();
    for (const e of collapsed) finalState.set(e.memberId, e.present);

    expect(finalState.get("a")).toBe(false);
    expect(finalState.get("b")).toBe(true);
    expect(finalState.get("c")).toBe(true);
  });
});
