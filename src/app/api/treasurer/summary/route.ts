import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { fetchTreasurerSummary } from "@/lib/payments/server/ledger";
import { churchToday } from "@/lib/time/church-time";

/**
 * PAY-5: the treasurer's home cards.
 *
 * Every figure comes from `fetchTreasurerSummary`, which shares its arithmetic with the ledger and the
 * overdue list. Spec §7: "numbers on cards and on pages they link to must agree", and two
 * implementations agree exactly once -- on the day they are written.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer", "admin"]);
  if (!g.ok) return g.response;

  try {
    const asOf = churchToday(await getSetting("report_timezone"));
    const summary = await fetchTreasurerSummary(asOf);
    return jsonOk(summary);
  } catch (e) {
    console.error("[treasurer/summary] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build the payments summary.");
  }
}