import type { SupabaseClient } from "@supabase/supabase-js";
import { broadcastPush } from "@/lib/push/broadcast";

export type LiturgySlotLine = {
  position_label: string;
  member_name: string | null;
  free_text: string | null;
};

/** PostgREST may return `members` as object or single-element array depending on typings. */
export function memberNameFromJoin(members: unknown): string | null {
  const row =
    members == null
      ? null
      : Array.isArray(members)
        ? (members[0] as { full_name?: string } | undefined)
        : (members as { full_name?: string });
  const name = row?.full_name?.trim();
  return name || null;
}

function mapJoinedRows(
  rows: Array<{
    position_label: unknown;
    free_text: unknown;
    members?: unknown;
  }>
): LiturgySlotLine[] {
  return (rows ?? []).map((row) => ({
    position_label: row.position_label as string,
    member_name: memberNameFromJoin(row.members),
    free_text: (row.free_text as string | null) ?? null,
  }));
}

export async function fetchPlannedSlotLines(
  sb: SupabaseClient,
  sessionDate: string,
  massId: string
): Promise<LiturgySlotLine[]> {
  const { data, error } = await sb
    .from("liturgy_planned")
    .select("position_label, free_text, members(full_name)")
    .eq("session_date", sessionDate)
    .eq("mass_id", massId)
    .order("sort_order", { ascending: true });
  if (error || !data?.length) return [];
  return mapJoinedRows(data);
}

export async function fetchSessionSlotLines(sb: SupabaseClient, sessionId: string): Promise<LiturgySlotLine[]> {
  const { data, error } = await sb
    .from("session_liturgy_servers")
    .select("position_label, free_text, members(full_name)")
    .eq("session_id", sessionId)
    .order("sort_order", { ascending: true });
  if (error || !data?.length) return [];
  return mapJoinedRows(data);
}

function formatBody(slots: LiturgySlotLine[]): string {
  return slots
    .map((s) => {
      const who = [s.member_name, s.free_text].filter(Boolean).join(" · ") || "—";
      return `${s.position_label}: ${who}`;
    })
    .join("\n");
}

export function liturgyPushNotificationTitle(sessionDate: string, massName: string): string {
  return `Servers · ${sessionDate} · ${massName}`;
}

/** Removes legacy auto-posted liturgy rows from the announcements table (if any). */
export async function deleteLiturgyLinkedAnnouncement(
  sb: SupabaseClient,
  sessionDate: string,
  massId: string
): Promise<void> {
  await sb
    .from("announcements")
    .delete()
    .eq("liturgy_session_date", sessionDate)
    .eq("liturgy_mass_id", massId);
}

/** Web push only — liturgy assignments are not stored as announcements. */
export async function pushLiturgyAssignmentsNotification(params: {
  sessionDate: string;
  massName: string;
  slots: LiturgySlotLine[];
  sendPush: boolean;
}): Promise<void> {
  const { sessionDate, massName, slots, sendPush } = params;
  if (!sendPush || slots.length === 0) return;
  const title = liturgyPushNotificationTitle(sessionDate, massName);
  const body = formatBody(slots);
  const preview = body.length > 160 ? `${body.slice(0, 157)}…` : body;
  void broadcastPush({
    title,
    body: preview,
    url: "/member",
  });
}

export async function notifyLiturgyFromPlanned(
  sb: SupabaseClient,
  sessionDate: string,
  massId: string,
  massName: string,
  sendPush: boolean
): Promise<void> {
  const slots = await fetchPlannedSlotLines(sb, sessionDate, massId);
  await pushLiturgyAssignmentsNotification({ sessionDate, massName, slots, sendPush });
}

export async function notifyLiturgyFromSession(sb: SupabaseClient, sessionId: string, sendPush: boolean): Promise<void> {
  const { data: sess, error } = await sb
    .from("attendance_sessions")
    .select("session_date, mass_id, masses(name)")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !sess) return;
  const massName = (sess.masses as { name?: string } | null)?.name ?? "Mass";
  const slots = await fetchSessionSlotLines(sb, sessionId);
  await pushLiturgyAssignmentsNotification({
    sessionDate: String(sess.session_date),
    massName,
    slots,
    sendPush,
  });
}
