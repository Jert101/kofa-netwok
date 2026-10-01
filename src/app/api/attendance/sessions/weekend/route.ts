import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { createWeekendSessions } from "@/features/attendance/server/create-weekend-sessions";

export const dynamic = "force-dynamic";

/**
 * ATT-2 manual button: "Create this weekend's sessions".
 *
 * For secretary and admin. Runs the same code as the cron
 * (`/api/cron/sessions`), so the two cannot drift apart.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  try {
    return jsonOk(await createWeekendSessions());
  } catch (e) {
    console.error(
      "[attendance/sessions/weekend] failed:",
      e instanceof Error ? e.message : e,
    );
    return internalError();
  }
}
