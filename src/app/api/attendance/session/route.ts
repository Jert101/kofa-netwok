import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, reportLocked, sessionExists, validationFailed } from "@/lib/api/response";
import { guardReportNotGenerated } from "@/lib/reports/check-report-lock";
import { createSessionAtDate } from "@/features/attendance/server/create-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mass_id: z.string().uuid(),
  member_ids: z.array(z.string().uuid()).default([]),
});

/**
 * Creates a session, or hands back the one that already exists for that date and
 * Mass.
 *
 * Sessions for future dates are allowed here on purpose. ATT-8 blocks *encoding*
 * attendance for a Mass that has not happened; it does not stop the parish from
 * setting up next Sunday's sessions in advance, which is how the weekend cron works.
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

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return validationFailed("Invalid body.", {});

  const sb = getSupabaseAdmin();

  try {
    const guard = await guardReportNotGenerated(sb, parsed.data.session_date);
    if (guard.blocked) return reportLocked(guard.message ?? "Attendance is locked for this month.");

    const { data: mass } = await sb
      .from("masses")
      .select("id, is_active")
      .eq("id", parsed.data.mass_id)
      .maybeSingle();

    if (!mass) return validationFailed("Invalid mass.", {});

    // A deactivated Mass keeps its history and stays editable, but new sessions for
    // it stop. Otherwise deactivating would be undone by the weekend cron.
    if (!mass.is_active) {
      return validationFailed("That Mass is deactivated, so new sessions cannot be created for it.", {});
    }

    const result = await createSessionAtDate(sb, {
      sessionDate: parsed.data.session_date,
      massId: parsed.data.mass_id,
      memberIds: parsed.data.member_ids,
    });

    if (result.status === "exists") {
      // 409 with the id, so the client opens the existing session instead of making
      // the secretary hunt for it on the calendar.
      return sessionExists(result.id);
    }

    return jsonOk({ id: result.id });
  } catch (e) {
    console.error("[attendance/sessions] create failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
