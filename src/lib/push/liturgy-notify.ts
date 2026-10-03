import { notify } from "@/lib/notify/notify";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The advance plan for a Mass changed.
 *
 * Push wording and recipients live in the event catalog; this file only knows how to find the Mass
 * name. Previously this sent to every subscription in the table with no topic check, so a member
 * who had opted out of parish announcements still got buzzed for a roster they never asked about.
 */
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

    await notify("liturgy_planned", {
      date: sessionDate,
      mass_label: massName,
      slot_count: slotCount,
    });
  } catch {
    /* never break API */
  }
}

/** The published roster for a session changed, or was cleared. */
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

    await notify("liturgy_servers_assigned", {
      date,
      mass_label: massName,
      slot_count: slotCount,
    });
  } catch {
    /* never break API */
  }
}
