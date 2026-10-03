import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { churchToday, loadUpcomingDays } from "@/features/liturgy/server/upcoming-data";
import {
  attentionSummary,
  formatDayLabel,
  needsAttention,
  windowFor,
} from "@/lib/liturgy/upcoming";

/**
 * LIT-5's officer half: "Needs attention" — dates in the next 14 days with unassigned positions
 * or no plan at all.
 *
 * Separate from `/api/liturgy/upcoming` because the audience is different (officers and admins)
 * and because this one is a worklist, not a list of assignments. The window is fixed at the
 * spec's 14 days and is not configurable: a worklist that can be widened to a year stops being a
 * list of this week's work.
 */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!guard.ok) return guard.response;

  const windowDays = 14;
  const { today } = await churchToday();
  const { start, end } = windowFor(today, windowDays);

  const sb = getSupabaseAdmin();
  const days = await loadUpcomingDays(sb, { start, end, viewerMemberId: null });

  const { data: massRows } = await sb
    .from("masses")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const masses = (massRows ?? []).map((m) => ({ id: String(m.id), name: String(m.name ?? "Mass") }));
  const items = needsAttention({ days, masses, today, windowDays });

  return Response.json({
    today,
    start,
    end,
    window_days: windowDays,
    summary: attentionSummary(items),
    items: items.map((i) => ({
      ...i,
      label: formatDayLabel(i.date),
    })),
  });
}