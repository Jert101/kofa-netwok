import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { churchToday } from "@/lib/time/church-time";
import { fetchTreasurerSummary } from "@/lib/payments/server/ledger";

/**
 * DSH-5: the treasurer's home data.
 *
 * A thin wrapper over module 09's `fetchTreasurerSummary` on purpose. The treasurer's cards and the
 * summary endpoint it links to have to show the same peso figure, and the only way that stays true
 * without checking by hand is for one of them to be the other.
 *
 * The treasurer's home page itself is a server component that calls `fetchTreasurerSummary` directly,
 * so this endpoint exists for the badge/count refresh path rather than for the first paint.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer"]);
  if (!g.ok) return g.response;

  try {
    const asOf = churchToday(await getSetting("report_timezone"));
    const summary = await fetchTreasurerSummary(asOf);
    return jsonOk(summary);
  } catch (e) {
    console.error("[dashboard/treasurer] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build your dashboard.");
  }
}