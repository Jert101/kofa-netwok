import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastPush } from "./broadcast";

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
    const path = `/member/day/${date}`;

    await broadcastPush({
      title: "Attendance updated",
      body: `${massName} · ${date}`,
      url: path,
    });
  } catch {
    /* never break attendance APIs */
  }
}
