import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notify/notify";
import { insertOnceByDedupeKey } from "@/lib/announcements/upsert-by-key";

export type LiturgySlotLine = {
  position_label: string;
  member_name: string | null;
  free_text: string | null;
};

/**
 * The single row behind an embedded join.
 *
 * PostgREST returns a to-one embed as an object, but its generated typings say array, so every
 * reader ends up handling both shapes. Answered once here rather than in each of them.
 */
export function joinedRow(joined: unknown): Record<string, unknown> | null {
  if (joined == null) return null;
  if (Array.isArray(joined)) return (joined[0] as Record<string, unknown> | undefined) ?? null;
  return joined as Record<string, unknown>;
}

/** PostgREST may return `members` as object or single-element array depending on typings. */
export function memberNameFromJoin(members: unknown): string | null {
  const name = joinedRow(members)?.full_name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** The Mass name behind an embedded `masses` join, for the same reason. */
export function massNameFromJoin(masses: unknown): string | null {
  const name = joinedRow(masses)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
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

export function liturgyPushNotificationTitle(sessionDate: string, massName: string): string {
  return `Servers · ${sessionDate} · ${massName}`;
}

/**
 * The idempotency key for the announcement about one date and Mass's roster.
 *
 * Two columns could have done this -- the parish asked for one announcement per date and Mass, and
 * migration 010 put a unique index on exactly that pair -- but `dedupe_key` is used instead because
 * it comes with a helper that resolves the collision explicitly. Asking PostgREST to treat a
 * composite unique index as its upsert arbiter is a thing that works until it does not.
 */
export function liturgyAnnouncementKey(sessionDate: string, massId: string): string {
  return `liturgy-servers:${sessionDate}:${massId}`;
}

/**
 * Post, or refresh, the announcement about one Mass's roster.
 *
 * `delete_at` is an instant computed by the caller from the day the officer picked, so the post
 * stays readable through that day rather than disappearing at midnight on it.
 *
 * `created_at` is refreshed on the way through. The roster of next Sunday is not the same document
 * as the roster of this Sunday, and leaving the original timestamp means re-announcing a Mass sits
 * at the bottom of the feed where nobody reads it -- while `updated_at` is left alone, because
 * "Edited" on a generated post would suggest a human rewrote it.
 */
export async function upsertLiturgyRosterAnnouncement(
  sb: SupabaseClient,
  params: {
    sessionDate: string;
    massId: string;
    title: string;
    body: string;
    deleteAt: string;
    fromRole: string;
  }
): Promise<string | null> {
  const result = await insertOnceByDedupeKey(sb, {
    dedupe_key: liturgyAnnouncementKey(params.sessionDate, params.massId),
    title: params.title,
    body: params.body,
    created_by: params.fromRole,
    created_at: new Date().toISOString(),
    delete_at: params.deleteAt,
    // Linked as well as keyed: this is what lets "clear the roster" take the notice about it with it.
    liturgy_session_date: params.sessionDate,
    liturgy_mass_id: params.massId,
    // Empty means everyone, which is what a Mass roster is. Stated rather than left null so a
    // reader of the row does not have to know that null and empty both mean the parish.
    audience_roles: [],
    audience_batches: [],
    pinned: false,
  });
  return result.id;
}

/** Removes the announcement about one date and Mass's roster, however it was found. */
export async function deleteLiturgyLinkedAnnouncement(
  sb: SupabaseClient,
  sessionDate: string,
  massId: string
): Promise<void> {
  // Both the keyed rows and the older link-only ones. A parish upgrading from before the key existed
  // would otherwise keep seeing a notice about a roster somebody cleared.
  await sb
    .from("announcements")
    .delete()
    .eq("dedupe_key", liturgyAnnouncementKey(sessionDate, massId));
  await sb
    .from("announcements")
    .delete()
    .eq("liturgy_session_date", sessionDate)
    .eq("liturgy_mass_id", massId);
}

/**
 * Remove one Mass's roster entirely, and the notice about it.
 *
 * One function because two routes can do this -- the editor's "Clear all" and the assign page's
 * delete -- and they used to be two copies that drifted. The session rows go too: a plan that has
 * been cleared but whose session sheet still names last month's servers is what makes a roster look
 * like it came back on its own.
 */
export async function clearPlannedRoster(
  sb: SupabaseClient,
  sessionDate: string,
  massId: string,
): Promise<void> {
  await sb.from("liturgy_planned").delete().eq("session_date", sessionDate).eq("mass_id", massId);

  const { data: sessions } = await sb
    .from("attendance_sessions")
    .select("id")
    .eq("session_date", sessionDate)
    .eq("mass_id", massId);
  for (const s of sessions ?? []) {
    await sb.from("session_liturgy_servers").delete().eq("session_id", s.id as string);
  }

  await deleteLiturgyLinkedAnnouncement(sb, sessionDate, massId);
}

/**
 * Tell the parish a roster changed.
 *
 * The wording is the catalog's, not this file's. What this decides is only *how much* to say: an
 * ordinary save sends the count, and a save the officer chose to announce sends the same lines the
 * announcement carries. `roster` is the difference, and passing it is the caller's decision.
 *
 * The old version always appended the entire roster, so the parish read other people's names on a
 * lock screen whether or not anyone had announced anything. That is now something the officer asks
 * for per assignment rather than something the app does to everyone.
 */
export async function pushLiturgyAssignmentsNotification(params: {
  sessionDate: string;
  massName: string;
  slots: LiturgySlotLine[];
  sendPush: boolean;
  /** One "Position: Name" line per slot. Omitted for a plain save, which sends the count only. */
  roster?: readonly string[];
}): Promise<void> {
  const { sessionDate, massName, slots, sendPush, roster } = params;
  if (!sendPush || slots.length === 0) return;

  await notify("liturgy_servers_assigned", {
    date: sessionDate,
    mass_label: massName,
    slot_count: slots.length,
    ...(roster && roster.length > 0 ? { roster } : {}),
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
