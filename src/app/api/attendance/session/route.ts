import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, reportLocked, sessionExists, validationFailed } from "@/lib/api/response";
import { guardReportNotGenerated } from "@/lib/reports/check-report-lock";
import {
  createGatheringAtDate,
  createSessionAtDate,
  createSessionBodySchema,
} from "@/features/attendance/server/create-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Creates a session, or hands back the one that already exists for that date.
 *
 * Two kinds, from one endpoint. A Mass session is keyed by (date, Mass) and keeps the cron, the planned
 * liturgy copy and the push notification. A **gathering** is a meeting or a training day: it has no Mass,
 * it is named, and it is deliberately kept out of the monthly report and out of every member's serving
 * totals, because "served" in this system means served at Mass.
 *
 * Sessions for future dates are allowed here on purpose. ATT-8 blocks *encoding* attendance for a Mass
 * that has not happened; it does not stop the parish from setting up next Sunday's sessions in advance,
 * which is how the weekend cron works. The same goes for a meeting next month.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return validationFailed("Invalid body.", {});
  }

  const parsed = createSessionBodySchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed(parsed.error.issues[0]?.message ?? "Invalid body.", {});
  }

  const sb = getSupabaseAdmin();
  const { session_date, member_ids, mass_id, title } = parsed.data;

  try {
    const guard = await guardReportNotGenerated(sb, session_date);
    if (guard.blocked) return reportLocked(guard.message ?? "Attendance is locked for this month.");

    if (title) {
      const result = await createGatheringAtDate(sb, {
        sessionDate: session_date,
        title,
        memberIds: member_ids,
      });
      if (result.status === "exists") return sessionExists(result.id);
      return jsonOk({ id: result.id, kind: "gathering" });
    }

    const { data: mass } = await sb.from("masses").select("id, is_active").eq("id", mass_id!).maybeSingle();
    if (!mass) return validationFailed("Invalid mass.", {});

    // A deactivated Mass keeps its history and stays editable, but new sessions for it stop. Otherwise
    // deactivating would be undone by the weekend cron.
    if (!mass.is_active) {
      return validationFailed("That Mass is deactivated, so new sessions cannot be created for it.", {});
    }

    const result = await createSessionAtDate(sb, {
      sessionDate: session_date,
      massId: mass_id!,
      memberIds: member_ids,
    });

    if (result.status === "exists") {
      // 409 with the id, so the client opens the existing session instead of making the secretary hunt for
      // it on the calendar.
      return sessionExists(result.id);
    }

    return jsonOk({ id: result.id, kind: "mass" });
  } catch (e) {
    console.error("[attendance/sessions] create failed:", e instanceof Error ? e.message : e);
    // A message that already names its own fix -- currently only the missing-migration error from
    // gathering creation -- is passed through. Raw database wording stays in the log, not on screen.
    const message = e instanceof Error ? e.message : "";
    if (message.includes("041_gathering_sessions.sql")) return internalError(message);
    return internalError();
  }
}
