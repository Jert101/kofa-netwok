import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { insertOnceByDedupeKey } from "./upsert-by-key";

type Call = { op: "insert" | "update"; payload: Record<string, unknown> };

/**
 * A structural fake: the helper only chains from()/insert()/update() through
 * select()/eq()/maybeSingle(), so this records the payloads without a
 * database. Nothing here may import server code -- this file runs in the
 * node test environment like every other lib test.
 */
function fakeDb(mode: "insert-ok" | "conflict" | "insert-error") {
  const calls: Call[] = [];
  const maybeSingle = async () => {
    if (mode === "conflict") return { data: { id: "existing-id" }, error: null };
    if (mode === "insert-error")
      return { data: null, error: { code: "23503", message: "foreign key violation" } };
    return { data: { id: "new-id" }, error: null };
  };
  const table = {
    insert: (payload: Record<string, unknown>) => {
      calls.push({ op: "insert", payload });
      if (mode === "conflict") {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: "23505", message: "duplicate key" },
            }),
          }),
        };
      }
      return { select: () => ({ maybeSingle }) };
    },
    update: (payload: Record<string, unknown>) => {
      calls.push({ op: "update", payload });
      return {
        eq: () => ({ select: () => ({ maybeSingle }) }),
      };
    },
  };
  return { sb: { from: () => table } as unknown as SupabaseClient, calls };
}

function row() {
  return {
    dedupe_key: "birthday:2026-10-11",
    title: "Birthday Greeting",
    body: "Happy Birthday!",
    created_by: "system",
    // What the birthday job used to send. The helper must drop it: it is the
    // "Edited" signal the feed prints, and no generated post is ever edited.
    updated_at: "2026-10-11T00:00:00.000Z",
  };
}

describe("insertOnceByDedupeKey", () => {
  it("inserts without the edited marker, even when the caller passes one", async () => {
    const { sb, calls } = fakeDb("insert-ok");
    const result = await insertOnceByDedupeKey(sb, row());
    expect(result).toEqual({ id: "new-id", inserted: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("insert");
    expect(calls[0].payload).not.toHaveProperty("updated_at");
    expect(calls[0].payload).toMatchObject({ dedupe_key: "birthday:2026-10-11" });
  });

  it("updates without the edited marker on a rerun", async () => {
    const { sb, calls } = fakeDb("conflict");
    const result = await insertOnceByDedupeKey(sb, row());
    expect(result).toEqual({ id: "existing-id", inserted: false });
    const update = calls.find((c) => c.op === "update");
    expect(update).toBeDefined();
    expect(update!.payload).not.toHaveProperty("updated_at");
  });

  it("throws on a real failure rather than swallowing it", async () => {
    const { sb } = fakeDb("insert-error");
    await expect(insertOnceByDedupeKey(sb, row())).rejects.toThrow("foreign key violation");
  });
});
