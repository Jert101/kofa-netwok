import type { SupabaseClient } from "@supabase/supabase-js";

export type DedupeResult = {
  id: string | null;
  /** False when the row already existed, which is the signal that this was a rerun. */
  inserted: boolean;
};

/**
 * COM-1: one announcement per generator key, however many times the generator runs.
 *
 * Insert first, catch the collision, update instead. `upsert(onConflict: "dedupe_key")` would read
 * more nicely, but the unique index behind the key is partial (`WHERE dedupe_key IS NOT NULL`) and
 * asking PostgREST to infer a partial index as its arbiter is a thing that works until it does not.
 * A unique violation is unambiguous, so the slow path is the reliable one.
 *
 * The generators that use this are crons: the birthday job and the report run, both of which get
 * retried by a scheduler and both of which would otherwise post the same message twice in front of
 * the parish.
 */
export async function insertOnceByDedupeKey(
  sb: SupabaseClient,
  row: { dedupe_key: string } & Record<string, unknown>,
): Promise<DedupeResult> {
  const { data, error } = await sb
    .from("announcements")
    .insert({ ...row, dedupe_key: row.dedupe_key })
    .select("id")
    .maybeSingle();

  if (!error) return { id: data?.id ? String(data.id) : null, inserted: true };

  if (error.code !== "23505") {
    // Anything else is a real failure and the caller needs to hear about it.
    throw new Error(error.message);
  }

  // `updated_at` is stripped rather than overwritten: it is the "Edited" signal the feed prints, and
  // a generated rerun is not an edit. The value is deliberately absent from the update.
  const rest: Record<string, unknown> = { ...row };
  delete rest.updated_at;
  const { data: updated, error: updErr } = await sb
    .from("announcements")
    .update(rest)
    .eq("dedupe_key", row.dedupe_key)
    .select("id")
    .maybeSingle();

  if (updErr) throw new Error(updErr.message);
  return { id: updated?.id ? String(updated.id) : null, inserted: false };
}
