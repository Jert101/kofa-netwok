import { broadcastPush } from "./broadcast";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function notifyLiturgyPlannedUpdated(
  sessionDate: string,
  massId: string,
  slotCount: number
): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    const { data: mass, error } = await sb.from("masses").select("name").eq("id", massId).maybeSingle();
    if (error || !mass) return;
    const massName = (mass.name as string) ?? "Mass";
    const path = `/member/day/${sessionDate}`;

    await broadcastPush({
      title: slotCount > 0 ? "Liturgy planned (advance)" : "Liturgy plan cleared",
      body: `${massName} · ${sessionDate}`,
      url: path,
    });
  } catch {
    /* never break API */
  }
}

export async function notifyLiturgyAssignmentsUpdated(
  sessionId: string,
  slotCount: number
): Promise<void> {
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
      title: slotCount > 0 ? "Liturgy servers assigned" : "Liturgy assignments cleared",
      body: `${massName} · ${date}`,
      url: path,
    });
  } catch {
    /* never break API */
  }
}
