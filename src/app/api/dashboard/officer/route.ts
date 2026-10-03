import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { churchToday, shiftDays } from "@/lib/time/church-time";

/**
 * DSH-3: the officer's "Needs attention".
 *
 * Dates in the next fortnight with positions that are planned but unfilled, or with no plan at all.
 * Reuses module 07's rule rather than restating it, so the card and the planner's own list cannot
 * disagree about which Mass needs work.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["officer"]);
  if (!g.ok) return g.response;

  try {
    const asOf = churchToday(await getSetting("report_timezone"));
    const until = shiftDays(asOf, 14);

    const sb = getSupabaseAdmin();

    // Planned rows carry a member or a guest name. A row with neither is a position nobody has filled.
    const [planned, sessions, masses] = await Promise.all([
      sb
        .from("liturgy_planned")
        .select("session_date, mass_id, position_label, member_id, free_text")
        .gte("session_date", asOf)
        .lte("session_date", until),
      sb
        .from("attendance_sessions")
        .select("id, session_date, mass_id, masses(name)")
        .gte("session_date", asOf)
        .lte("session_date", until),
      sb.from("masses").select("id, name"),
    ]);

    const massNameById = new Map((masses.data ?? []).map((m) => [String(m.id), String(m.name)]));

    const plannedRows = planned.data ?? [];
    const byDate = new Map<string, { total: number; filled: number; masses: Set<string> }>();

    for (const row of plannedRows) {
      const date = String(row.session_date);
      const entry = byDate.get(date) ?? { total: 0, filled: 0, masses: new Set<string>() };
      entry.total += 1;
      const filled = Boolean(row.member_id) || Boolean(row.free_text);
      if (filled) entry.filled += 1;
      entry.masses.add(massNameById.get(String(row.mass_id)) ?? "Mass");
      byDate.set(date, entry);
    }

    const needsAttention = [...byDate.entries()]
      .map(([date, entry]) => ({
        date,
        mass_names: [...entry.masses],
        positions: entry.total,
        unassigned: entry.total - entry.filled,
        href: `/officer/day/${date}`,
      }))
      .filter((row) => row.unassigned > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    // A date with no planned rows at all but a session exists is a Mass nobody has started planning.
    const plannedDates = new Set(plannedRows.map((r) => String(r.session_date)));
    const unplanned = (sessions.data ?? [])
      .filter((s) => !plannedDates.has(String(s.session_date)))
      .map((s) => ({
        date: String(s.session_date),
        mass_names: [
          (s.masses as { name?: string } | null)?.name ??
            massNameById.get(String(s.mass_id)) ??
            "Mass",
        ],
        positions: 0,
        unassigned: 0,
        href: `/officer/day/${String(s.session_date)}`,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));


    return jsonOk({
      as_of: asOf,
      until,
      needs_attention: needsAttention,
      unplanned,
      empty: needsAttention.length === 0 && unplanned.length === 0,
    });
  } catch (e) {
    console.error("[dashboard/officer] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build your dashboard.");
  }
}