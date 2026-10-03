import type { SupabaseClient } from "@supabase/supabase-js";
import { getAllSettings } from "@/lib/settings/store";
import { todayInTimeZone } from "@/lib/attendance/metrics";
import { memberNameFromJoin } from "@/lib/attendance/liturgy-announcement";
import {
  pickEffectiveSlots,
  windowFor,
  type PlanRow,
  type UpcomingDay,
  type UpcomingSlot,
} from "@/lib/liturgy/upcoming";

/**
 * LIT-5's data layer.
 *
 * Both tables are read whole for the window and grouped here in memory rather than joined and
 * re-sorted per query. That looks less efficient than a join and is deliberately so: the earlier
 * version matched rows between two separately-ordered queries by array position, which silently
 * attaches the wrong member_id to a row whenever two rows share a sort_order. The grouping is
 * keyed by (date, Mass) instead, which cannot drift.
 */

/** Today, in church time. Spec §8: "tomorrow" is computed in church time, not the browser's. */
export async function churchToday(): Promise<{ today: string; timeZone: string }> {
  const settings = await getAllSettings();
  const timeZone = settings.report_timezone || "UTC";
  return { today: todayInTimeZone(new Date(), timeZone), timeZone };
}

type Grouped = Map<string, PlanRow[]>;

export async function loadUpcomingDays(
  sb: SupabaseClient,
  input: { start: string; end: string; viewerMemberId: string | null },
): Promise<UpcomingDay[]> {
  const [masses, planned, served, massTimes] = await Promise.all([
    readActiveMasses(sb),
    readPlanned(sb, input.start, input.end),
    readServed(sb, input.start, input.end),
    readMassTimes(sb),
  ]);

  const effective = new Map<string, { source: "session" | "planned"; slots: PlanRow[] }>();
  for (const mass of masses) {
    for (const date of datesInRange(input.start, input.end)) {
      const key = `${date}\0${mass.id}`;
      effective.set(key, pickEffectiveSlots(planned.get(key) ?? [], served.rows.get(key) ?? []));
    }
  }

  const days: UpcomingDay[] = [];
  for (const date of datesInRange(input.start, input.end)) {
    const dayMasses = [];

    for (const mass of masses) {
      const key = `${date}\0${mass.id}`;
      const rows = effective.get(key);
      if (!rows || rows.slots.length === 0) continue;

      const slots: UpcomingSlot[] = rows.slots.map((r) => ({
        position_label: r.position_label,
        member_id: r.member_id,
        member_name: r.member_name,
        free_text: r.free_text,
        mine: r.member_id !== null && r.member_id === input.viewerMemberId,
      }));

      dayMasses.push({
        mass_id: mass.id,
        mass_name: mass.name,
        // Null whenever the rows came from the plan rather than a session, which is the
        // distinction "Needs attention" and the PDF both need to know.
        session_id: rows.source === "session" ? (served.sessionByKey.get(key) ?? null) : null,
        time: massTimes.get(mass.id) ?? null,
        slots,
      });
    }

    if (dayMasses.length > 0) days.push({ date, masses: dayMasses });
  }

  return days;
}

type MassRow = { id: string; name: string };

async function readActiveMasses(sb: SupabaseClient): Promise<MassRow[]> {
  const { data } = await sb
    .from("masses")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []).map((m) => ({ id: String(m.id), name: String(m.name ?? "Mass") }));
}

async function readMassTimes(sb: SupabaseClient): Promise<Map<string, string | null>> {
  const { data } = await sb.from("masses").select("id, default_time");
  return new Map(
    (data ?? []).map((m) => [String(m.id), (m.default_time as string | null) ?? null]),
  );
}

async function readPlanned(
  sb: SupabaseClient,
  start: string,
  end: string,
): Promise<Grouped> {
  const { data } = await sb
    .from("liturgy_planned")
    .select(
      "session_date, mass_id, position_label, member_id, free_text, sort_order, members(full_name)",
    )
    .gte("session_date", start)
    .lte("session_date", end)
    .order("mass_id", { ascending: true })
    .order("sort_order", { ascending: true });

  const out: Grouped = new Map();
  for (const r of data ?? []) {
    const key = `${String(r.session_date)}\0${String(r.mass_id)}`;
    push(out, key, r);
  }
  return out;
}

async function readServed(
  sb: SupabaseClient,
  start: string,
  end: string,
): Promise<{ rows: Grouped; sessionByKey: Map<string, string> }> {
  const { data: sessions } = await sb
    .from("attendance_sessions")
    .select("id, session_date, mass_id")
    .gte("session_date", start)
    .lte("session_date", end);

  const ids = (sessions ?? []).map((s) => String(s.id));
  const out: Grouped = new Map();
  const sessionByKey = new Map<string, string>();
  if (ids.length === 0) return { rows: out, sessionByKey };

  const { data } = await sb
    .from("session_liturgy_servers")
    .select(
      "session_id, position_label, member_id, free_text, sort_order, members(full_name)",
    )
    .in("session_id", ids)
    .order("sort_order", { ascending: true });

  const massBySession = new Map((sessions ?? []).map((s) => [String(s.id), String(s.mass_id)]));
  const dateBySession = new Map((sessions ?? []).map((s) => [String(s.id), String(s.session_date)]));

  for (const r of data ?? []) {
    const sessionId = String(r.session_id);
    const massId = massBySession.get(sessionId);
    const date = dateBySession.get(sessionId);
    if (!massId || !date) continue;
    const key = `${date}\0${massId}`;
    sessionByKey.set(key, sessionId);
    push(out, key, r);
  }
  return { rows: out, sessionByKey };
}

function push(target: Grouped, key: string, row: Record<string, unknown>) {
  const list = target.get(key) ?? [];
  list.push({
    position_label: String(row.position_label ?? ""),
    member_id: (row.member_id as string | null) ?? null,
    free_text: (row.free_text as string | null) ?? null,
    member_name: memberNameFromJoin(row.members),
  });
  target.set(key, list);
}

const MS_PER_DAY = 86_400_000;

function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setTime(cursor.getTime() + MS_PER_DAY);
  }
  return out;
}

export { windowFor };