import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Roster writes for one session.
 *
 * The rule that shapes all of this: a change names one member. Nothing here reads
 * the whole roster and writes it back. That is what makes two secretaries encoding
 * the same Mass safe — their requests touch different rows, so they cannot undo
 * each other even if they arrive at the same moment.
 */

export type PresenceChange = { memberId: string; present: boolean };

export type RosterWriteResult = {
  /** Members whose attendance state actually changed. */
  changed: number;
  /** Members already in the requested state, so the call was a no-op. */
  unchanged: number;
  present: number;
};

async function readPresentIds(sb: SupabaseClient, sessionId: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from("attendance_records")
    .select("member_id")
    .eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.member_id as string));
}

/**
 * Applies each change as its own statement.
 *
 * Not a bulk insert or a delete-where-not-in. A single statement touching many rows
 * would take locks across all of them and reintroduce the interleaving this is meant
 * to avoid. Per-member statements mean one secretary's tap on Ana cannot block or
 * undo another's tap on Ben.
 *
 * Repeat changes for the same member in one request are collapsed to the last one,
 * so a client that batches optimistically does not apply an intermediate state that
 * was never on screen.
 */
export async function applyPresenceChanges(
  sb: SupabaseClient,
  sessionId: string,
  changes: PresenceChange[],
): Promise<RosterWriteResult> {
  const latest = new Map<string, boolean>();
  for (const change of changes) latest.set(change.memberId, change.present);

  const alreadyPresent = await readPresentIds(sb, sessionId);
  let changed = 0;
  let unchanged = 0;

  for (const [memberId, present] of latest) {
    const isPresent = alreadyPresent.has(memberId);

    if (present === isPresent) {
      unchanged++;
      continue;
    }

    if (present) {
      const { error } = await sb
        .from("attendance_records")
        // onConflict makes a duplicate insert a no-op rather than a 500, which is
        // what happens if two devices both mark the same person present.
        .upsert(
          { session_id: sessionId, member_id: memberId, source: "encoded" },
          { onConflict: "session_id,member_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb
        .from("attendance_records")
        .delete()
        .eq("session_id", sessionId)
        .eq("member_id", memberId);
      if (error) throw new Error(error.message);
    }

    changed++;
    if (present) alreadyPresent.add(memberId);
    else alreadyPresent.delete(memberId);
  }

  return { changed, unchanged, present: alreadyPresent.size };
}

/**
 * Marks every active member present.
 *
 * Only active members. A member deactivated after a previous Mass was recorded
 * should not reappear as present in a new one, but their existing records stay
 * untouched — the spec calls for that, and it is the difference between "inactive
 * today" and "was never there".
 */
export async function markAllPresent(
  sb: SupabaseClient,
  sessionId: string,
): Promise<{ marked: number; skipped: number }> {
  const { data: members, error: mErr } = await sb
    .from("members")
    .select("id")
    .eq("is_active", true);
  if (mErr) throw new Error(mErr.message);

  const activeIds = (members ?? []).map((m) => m.id as string);
  const already = await readPresentIds(sb, sessionId);
  const toAdd = activeIds.filter((id) => !already.has(id));

  if (toAdd.length) {
    const rows = toAdd.map((member_id) => ({
      session_id: sessionId,
      member_id,
      source: "encoded",
    }));
    const { error } = await sb
      .from("attendance_records")
      .upsert(rows, { onConflict: "session_id,member_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  return { marked: toAdd.length, skipped: already.size };
}

/** Clears the whole roster, for undoing a mark-all. */
export async function clearAll(sb: SupabaseClient, sessionId: string): Promise<{ cleared: number }> {
  const already = await readPresentIds(sb, sessionId);
  const { error } = await sb.from("attendance_records").delete().eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  return { cleared: already.size };
}
