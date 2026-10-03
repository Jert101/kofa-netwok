import { getSupabaseAdmin } from "@/lib/supabase/admin";
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
    const { data: session, error } = await sb
      .from("attendance_sessions")
      .select("session_date, masses(name)")
      .eq("id", sessionId)
      .maybeSingle();
    if (error || !session) return;

    const date = String(session.session_date);
    const massName = (session.masses as { name?: string } | null)?.name ?? "Mass";

    await notify("attendance_updated", {
      date,
      label: `${massName} - ${date}`,
    });
  } catch {
    /* never break attendance APIs */
  }
}
