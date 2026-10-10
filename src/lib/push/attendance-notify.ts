import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { selectSessionsResilient, sessionLabel } from "@/lib/attendance/guard-session-write";
import { notify } from "@/lib/notify/notify";

/**
 * Roster changed for a session, so anybody serving that day hears about it.
 *
 * Kept as a named function with the same signature as before, because seven attendance call sites
 * fire it and none of them should care that the copy now lives in the event catalog. The old body
 * built the string here and handed it to `broadcastPush`, which meant every phone in the parish
 * got it regardless of whether the person had turned roster notifications off.
 */
export async function notifyAttendanceSessionUpdated(sessionId: string): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    // Resilient like the other session reads: without it a pre-041 database would skip every
    // notification, Masses included, because the `title` select fails.
    const { data: session, error } = await selectSessionsResilient<Record<string, unknown>>(
      (columns) => sb.from("attendance_sessions").select(columns).eq("id", sessionId).maybeSingle(),
      "session_date, mass_id, title, masses(name)",
      "session_date, mass_id, masses(name)",
    );
    if (error || !session) return;

    // A meeting's roster changing is not parish news. This push tells the parish "the roster for this
    // Mass changed, if you are serving that day" -- and for a gathering there is no Mass to name and
    // no serving audience to reach, only the secretary who just made the change and the people in the
    // room. Skipped here rather than at seven call sites, so no future caller can get it wrong.
    if (session.mass_id == null) return;

    const date = String(session.session_date);
    const massName = sessionLabel({
      mass_id: session.mass_id as string | null,
      title: session.title as string | null,
      massName: (session.masses as { name?: string } | null)?.name,
    });

    await notify("attendance_updated", {
      date,
      label: `${massName} - ${date}`,
    });
  } catch {
    /* never break attendance APIs */
  }
}
