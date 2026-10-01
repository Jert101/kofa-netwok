import type { SupabaseClient } from "@supabase/supabase-js";
import { copyPlannedLiturgyToSession } from "@/lib/attendance/copy-planned-liturgy";

/**
 * Creates the session for one (date, mass), or reports that it is already there.
 *
 * Both the manual "add session" form and the weekend cron come through here, so the
 * duplicate rule lives in one place. Getting that wrong is the expensive case: the
 * cron runs unattended, so a missing check means it quietly creates a second copy of
 * every Sunday Mass a week later, and the secretary then marks attendance twice and
 * cannot tell which is the real one.
 *
 * `upsert` on (session_date, mass_id) makes the insert itself safe against two
 * requests landing at once, which a pre-check-then-insert could not be. The
 * pre-check exists only to return a nicer response: the loser of a race gets the
 * existing id instead of a raw database error.
 */

export type CreateSessionResult =
  | { status: "created"; id: string }
  | { status: "exists"; id: string };

export type CreateSessionOptions = {
  sessionDate: string;
  massId: string;
  /** Members to pre-mark present. Used by the add-session form. */
  memberIds?: string[];
  /** The weekend cron notifies once for the whole batch, so it passes false here. */
  notify?: boolean;
};

export async function createSessionAtDate(
  sb: SupabaseClient,
  { sessionDate, massId, memberIds = [], notify = true }: CreateSessionOptions,
): Promise<CreateSessionResult> {
  const existing = await findExistingSession(sb, sessionDate, massId);
  if (existing) return { status: "exists", id: existing };

  // onConflict needs the unique index from migration 027 to exist. Until that
  // migration is applied this cannot deduplicate, which is another reason not to
  // point the cron at production before it runs.
  const { data: inserted, error } = await sb
    .from("attendance_sessions")
    .upsert(
      { session_date: sessionDate, mass_id: massId },
      { onConflict: "session_date,mass_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    // A concurrent request won the race. That is success from the caller's point of
    // view, not a failure, so report the session it created.
    const raced = await findExistingSession(sb, sessionDate, massId);
    if (raced) return { status: "exists", id: raced };
    throw new Error(`Could not create session: ${error.message}`);
  }

  if (!inserted) {
    const raced = await findExistingSession(sb, sessionDate, massId);
    if (!raced) throw new Error("Could not create session and none exists.");
    return { status: "exists", id: raced };
  }

  const id = inserted.id as string;

  await copyPlannedLiturgyToSession(sb, id, sessionDate, massId);

  const unique = [...new Set(memberIds)];
  if (unique.length) {
    const rows = unique.map((member_id) => ({ session_id: id, member_id }));
    const { error: insertError } = await sb.from("attendance_records").insert(rows);
    if (insertError) {
      // Undo the session so the secretary does not find an empty Mass on the
      // calendar that they never created and cannot explain.
      await sb.from("attendance_sessions").delete().eq("id", id);
      throw new Error(insertError.message);
    }
  }

  if (notify) {
    const { notifyAttendanceSessionUpdated } = await import("@/lib/push/attendance-notify");
    void notifyAttendanceSessionUpdated(id);
  }

  return { status: "created", id };
}

export async function findExistingSession(
  sb: SupabaseClient,
  sessionDate: string,
  massId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("attendance_sessions")
    .select("id")
    .eq("session_date", sessionDate)
    .eq("mass_id", massId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}
