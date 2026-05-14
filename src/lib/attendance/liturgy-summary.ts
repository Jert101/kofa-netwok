import type { SupabaseClient } from "@supabase/supabase-js";
import { memberNameFromJoin } from "@/lib/attendance/liturgy-announcement";

export type LiturgySlotPublic = {
  position_label: string;
  member_name: string | null;
  free_text: string | null;
};

export type LiturgyMassDay = {
  mass_id: string;
  mass_name: string;
  session_id: string | null;
  slots: LiturgySlotPublic[];
};

export type LiturgyDaySummary = {
  date: string;
  masses: LiturgyMassDay[];
};

function mapSlotRows(
  rows: Array<{
    position_label: unknown;
    member_id: unknown;
    free_text: unknown;
    members?: unknown;
  }>
): LiturgySlotPublic[] {
  return rows.map((row) => ({
    position_label: row.position_label as string,
    member_name: memberNameFromJoin(row.members),
    free_text: (row.free_text as string | null) ?? null,
  }));
}

/** Server UTC calendar date YYYY-MM-DD (matches stored `date` values). */
export function liturgySummaryTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Drop planned rows before today so dashboards stay current. */
export async function deletePastLiturgyPlanned(sb: SupabaseClient, todayYmd: string): Promise<void> {
  await sb.from("liturgy_planned").delete().lt("session_date", todayYmd);
}

export async function buildLiturgySummaryForRange(
  sb: SupabaseClient,
  startDate: string,
  endDate: string,
  options?: { allowPastDates?: boolean }
): Promise<LiturgyDaySummary[]> {
  const today = liturgySummaryTodayUtc();
  const start = options?.allowPastDates ? startDate : startDate < today ? today : startDate;
  if (start > endDate) return [];

  const { data: masses, error: mErr } = await sb
    .from("masses")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (mErr || !masses?.length) return [];

  const { data: sessions, error: sErr } = await sb
    .from("attendance_sessions")
    .select("id, session_date, mass_id")
    .gte("session_date", start)
    .lte("session_date", endDate);
  if (sErr) return [];

  const sessionByDateMass = new Map<string, string>();
  const sessionIds: string[] = [];
  for (const s of sessions ?? []) {
    const d = String(s.session_date);
    const mid = s.mass_id as string;
    sessionByDateMass.set(`${d}\0${mid}`, s.id as string);
    sessionIds.push(s.id as string);
  }

  const sessionSlotsById = new Map<string, LiturgySlotPublic[]>();
  if (sessionIds.length) {
    const { data: sRows, error: ssErr } = await sb
      .from("session_liturgy_servers")
      .select("session_id, position_label, member_id, free_text, sort_order, members(full_name)")
      .in("session_id", sessionIds)
      .order("sort_order", { ascending: true });
    if (!ssErr && sRows?.length) {
      const grouped = new Map<string, typeof sRows>();
      for (const r of sRows) {
        const sid = r.session_id as string;
        if (!grouped.has(sid)) grouped.set(sid, []);
        grouped.get(sid)!.push(r);
      }
      for (const [sid, rows] of grouped) {
        sessionSlotsById.set(sid, mapSlotRows(rows));
      }
    }
  }

  const { data: plannedRows, error: pErr } = await sb
    .from("liturgy_planned")
    .select("session_date, mass_id, position_label, member_id, free_text, sort_order, members(full_name)")
    .gte("session_date", start)
    .lte("session_date", endDate)
    .order("sort_order", { ascending: true });

  const plannedByKey = new Map<string, LiturgySlotPublic[]>();
  if (!pErr && plannedRows?.length) {
    for (const r of plannedRows) {
      const d = String(r.session_date);
      const mid = r.mass_id as string;
      const key = `${d}\0${mid}`;
      if (!plannedByKey.has(key)) plannedByKey.set(key, []);
      plannedByKey.get(key)!.push(mapSlotRows([r])[0]);
    }
  }

  const days: string[] = [];
  const cur = new Date(`${start}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  const out: LiturgyDaySummary[] = [];
  for (const date of days) {
    const massesDay: LiturgyMassDay[] = [];
    for (const m of masses) {
      const massId = m.id as string;
      const massName = (m.name as string) ?? "Mass";
      const key = `${date}\0${massId}`;
      const sid = sessionByDateMass.get(key) ?? null;
      let slots: LiturgySlotPublic[] = [];
      if (sid) {
        slots = sessionSlotsById.get(sid) ?? [];
        if (!slots.length) slots = plannedByKey.get(key) ?? [];
      } else {
        slots = plannedByKey.get(key) ?? [];
      }
      if (slots.length) {
        massesDay.push({ mass_id: massId, mass_name: massName, session_id: sid, slots });
      }
    }
    if (massesDay.length) out.push({ date, masses: massesDay });
  }
  return out;
}
