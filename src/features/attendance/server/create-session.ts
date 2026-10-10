import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
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

/**
 * What `POST /api/attendance/session` accepts.
 *
 * Exactly one of `mass_id` / `title` identifies what the session is. A discriminated union rather than
 * two optional fields, because two optional fields admit the two states that cannot be stored: neither
 * (a session for nothing) and both (a Mass with a name, which is a second answer to "what is this" and
 * which the database constraint refuses). Zod checks the distinction so the secretary gets a sentence
 * about it, instead of the insert failing later with a constraint name they cannot act on.
 */
export const createSessionBodySchema = z
  .object({
    session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    member_ids: z.array(z.string().uuid()).default([]),
    mass_id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => (v.mass_id ? !v.title : Boolean(v.title)), {
    message: "Choose either a Mass or a name for the meeting — not both.",
    path: ["mass_id"],
  });

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

export type CreateGatheringResult =
  | { status: "created"; id: string }
  | { status: "exists"; id: string };

export type CreateGatheringOptions = {
  sessionDate: string;
  title: string;
  memberIds?: string[];
};

/**
 * Creates the session for a non-Mass gathering on one date, or reports that it is already there.
 *
 * ## Why this is not `createSessionAtDate` with a null Mass
 *
 * The Mass path upserts on `onConflict: "session_date,mass_id"`, which is the whole reason two requests
 * landing at once cannot produce two Sunday sessions. That conflict target names a column, and a NULL is
 * not equal to a NULL in a unique index -- so an upsert keyed on a null `mass_id` never matches, and every
 * press of the button would insert another row. The pre-check below would hide that for one user at a
 * time; it would not survive the weekend cron, or a secretary double-tapping on a phone.
 *
 * So the deduplication is moved to the database, where it actually holds: a partial unique index on
 * `session_date WHERE mass_id IS NULL` (migration 041). The insert below is a plain one, and a violation
 * is caught and answered as "already exists" with the existing id -- the same response the Mass path gives
 * the loser of a race.
 *
 * ## Why no planned liturgy is copied
 *
 * `copyPlannedLiturgyToSession` needs a Mass: the plan is keyed by (date, mass) and the copy is what
 * turns an officer's forward roster into a session's servers. A gathering has no Mass, so there is no
 * plan to find and nothing to copy. Skipping it is correct rather than merely convenient -- and the
 * session screen hides the liturgy tab for a gathering so nobody is shown an empty server list and
 * concludes the ministry failed to assign anybody.
 */
export async function createGatheringAtDate(
  sb: SupabaseClient,
  { sessionDate, title, memberIds = [] }: CreateGatheringOptions,
): Promise<CreateGatheringResult> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("A gathering needs a name.");

  const existing = await findExistingGathering(sb, sessionDate);
  if (existing) return { status: "exists", id: existing };

  const { data: inserted, error } = await sb
    .from("attendance_sessions")
    .insert({ session_date: sessionDate, mass_id: null, title: trimmed })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 is the partial unique index doing its job: another request for this date won. That is the
    // same outcome as the pre-check finding a row, and it is reported as such rather than as a failure.
    if (error.code === "23505") {
      const raced = await findExistingGathering(sb, sessionDate);
      if (raced) return { status: "exists", id: raced };
    }
    // 23502 on `mass_id` means the database predates migration 041, where the column was still NOT
    // NULL -- this insert sets nothing else that could violate not-null. Named rather than passed
    // through: a raw constraint violation tells the secretary nothing, and the fix is a migration,
    // not a different tap.
    if (error.code === "23502" && /mass_id/.test(error.message)) {
      throw new Error(
        "Meetings need migration 041_gathering_sessions.sql applied to the database first.",
      );
    }
    throw new Error(`Could not create gathering: ${error.message}`);
  }

  if (!inserted) {
    const raced = await findExistingGathering(sb, sessionDate);
    if (!raced) throw new Error("Could not create gathering and none exists.");
    return { status: "exists", id: raced };
  }

  const id = inserted.id as string;

  const unique = [...new Set(memberIds)];
  if (unique.length) {
    const rows = unique.map((member_id) => ({ session_id: id, member_id }));
    const { error: insertError } = await sb.from("attendance_records").insert(rows);
    if (insertError) {
      // Undo, for the same reason the Mass path does: a half-created session shows on the calendar as
      // something the secretary never made and cannot explain.
      await sb.from("attendance_sessions").delete().eq("id", id);
      throw new Error(insertError.message);
    }
  }

  // No notification, on purpose. The session-update push tells the parish "the roster for this Mass
  // changed", and a meeting has no Mass to name. The secretary who just created it is standing in
  // front of it, so there is nobody to inform and no correct sentence to inform them with.
  return { status: "created", id };
}

/** The gathering already on this date, if any. */
export async function findExistingGathering(
  sb: SupabaseClient,
  sessionDate: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("attendance_sessions")
    .select("id")
    .eq("session_date", sessionDate)
    .is("mass_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}
