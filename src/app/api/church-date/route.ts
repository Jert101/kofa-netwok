import { NextRequest } from "next/server";

import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { churchToday } from "@/lib/time/church-time";
import type { Role } from "@/lib/auth/roles";

/** Any signed-in role. This reads configuration, not anyone's records. */
const ANY_ROLE: Role[] = [
  "admin",
  "super_admin",
  "secretary",
  "member",
  "officer",
  "treasurer",
];

/**
 * Today, in the church's timezone.
 *
 * The treasurer's payment sheet needs this to open its date field on the parish's idea of today rather
 * than the browser's. It used to fetch `/api/admin/settings` for the one key it wanted, which is
 * admin-only -- so a treasurer got a 401, `today` stayed empty, and the page showed a permanent
 * "Today is…" above a date field with `max=""`, which is a field with no upper bound at all.
 *
 * Narrower than the settings blob it replaces, and reusable by any screen that has to ask what day it
 * is for the parish.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ANY_ROLE);
  if (!g.ok) return g.response;

  try {
    const timezone = await getSetting("report_timezone");
    let today: string;
    try {
      today = churchToday(timezone);
    } catch {
      // A bad timezone in the settings must not make the page unusable; fall back to UTC, which is
      // what churchToday would do anyway if the zone were simply absent.
      today = churchToday(null);
    }
    return jsonOk({ today, timezone: timezone ?? null });
  } catch (e) {
    console.error("[church-date] read failed:", e instanceof Error ? e.message : e);
    return internalError("Could not read the church date.");
  }
}