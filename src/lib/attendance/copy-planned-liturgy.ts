import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Copies liturgy_planned rows into session_liturgy_servers for a new session, then removes the planned rows.
 */
export async function copyPlannedLiturgyToSession(
  sb: SupabaseClient,
  sessionId: string,
  sessionDate: string,
  massId: string
): Promise<void> {
  const { data: planned, error: pErr } = await sb
    .from("liturgy_planned")
    .select("position_label, member_id, free_text, sort_order")
    .eq("session_date", sessionDate)
    .eq("mass_id", massId)
    .order("sort_order", { ascending: true });

  if (pErr || !planned?.length) return;

  const now = new Date().toISOString();
  const rows = planned.map((p, i) => ({
    session_id: sessionId,
    position_label: p.position_label as string,
    member_id: (p.member_id as string | null) ?? null,
    free_text: (p.free_text as string | null) ?? null,
    sort_order: typeof p.sort_order === "number" ? p.sort_order : i,
    updated_at: now,
  }));

  const { error: insErr } = await sb.from("session_liturgy_servers").insert(rows);
  if (insErr) return;

  await sb.from("liturgy_planned").delete().eq("session_date", sessionDate).eq("mass_id", massId);
}
