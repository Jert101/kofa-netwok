import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ROLE_ORDER } from "@/lib/auth/roles";
import { churchToday, loadUpcomingDays } from "@/features/liturgy/server/upcoming-data";
import {
  clampWindowDays,
  countOwnAssignments,
  filterUpcoming,
  formatDayLabel,
  formatMassTime,
  pinOwnDays,
  windowFor,
} from "@/lib/liturgy/upcoming";

/**
 * LIT-5: upcoming assignments.
 *
 * Open to every signed-in role, not just officers — spec §5 says "any signed in", and the point of
 * the feature is that a member can find their own name without asking anybody.
 *
 * Names and positions only. No member ids leave through this route except the viewer's own, which
 * the browser already has.
 */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req.headers.get("cookie"), [...ROLE_ORDER]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const windowDays = clampWindowDays(url.searchParams.get("days"));
  const q = url.searchParams.get("q");

  const { today } = await churchToday();
  const { start, end } = windowFor(today, windowDays);

  const viewerMemberId = guard.session.actor?.id ?? null;
  const all = await loadUpcomingDays(getSupabaseAdmin(), { start, end, viewerMemberId });

  const visible = pinOwnDays(filterUpcoming(all, q));

  return Response.json({
    today,
    start,
    end,
    window_days: windowDays,
    viewer_identified: viewerMemberId !== null,
    own_count: countOwnAssignments(all),
    days: visible.map((d) => ({
      date: d.date,
      label: formatDayLabel(d.date),
      masses: d.masses.map((m) => ({
        mass_id: m.mass_id,
        mass_name: m.mass_name,
        session_id: m.session_id,
        time_label: formatMassTime(m.time),
        slots: m.slots.map((s) => ({
          position_label: s.position_label,
          // The viewer's own rows get their id back; everyone else's stays server-side so the
          // page cannot be used to enumerate the whole parish's assignments by member id.
          member_id: s.mine ? s.member_id : null,
          member_name: s.member_name ?? s.free_text,
          is_guest: s.member_id === null,
          mine: s.mine,
        })),
      })),
    })),
  });
}