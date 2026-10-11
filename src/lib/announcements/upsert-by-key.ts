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
 *
 * `updated_at` is stripped from both payloads, not just the update. It is the "Edited" signal the
 * feed prints, and a generated post is never edited by a human -- system rows refuse PATCH entirely.
 * The birthday job once sent it on insert, so every greeting was born carrying an "· Edited" marker
 * no human had earned. Stripping it here as well as at the call sites means no future generator can
 * repeat that by passing one more field.
 */
export async function insertOnceByDedupeKey(
  sb: SupabaseClient,
  row: { dedupe_key: string } & Record<string, unknown>,
): Promise<DedupeResult> {
  const withoutMarker: Record<string, unknown> = { ...row };
  delete withoutMarker.updated_at;
  const { data, error } = await sb
    .from("announcements")
    .insert({ ...withoutMarker, dedupe_key: row.dedupe_key })
    .select("id")
    .maybeSingle();

  if (!error) return { id: data?.id ? String(data.id) : null, inserted: true };

  if (error.code !== "23505") {
    // Anything else is a real failure and the caller needs to hear about it.
    throw new Error(error.message);
  }

  // `updated_at` is already absent (see above), so unlike before there is no
  // second strip here: the insert and the rerun write the same field set, and
  // a rerun can never mark the row edited.
  const { data: updated, error: updErr } = await sb
    .from("announcements")
    .update(withoutMarker)
    .eq("dedupe_key", row.dedupe_key)
    .select("id")
    .maybeSingle();

  if (updErr) throw new Error(updErr.message);
  return { id: updated?.id ? String(updated.id) : null, inserted: false };
}
