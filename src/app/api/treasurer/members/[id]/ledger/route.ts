import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, notFound } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { fetchMemberLedger } from "@/lib/payments/server/ledger";
import { churchToday } from "@/lib/time/church-time";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PAY-4: one member's ledger.
 *
 * Treasurer and admin only. This is the richest payment view there is -- every structure, every
 * installment, every payment including the voided ones -- so it does not go through the limited
 * lookup's visibility rules, it simply is not reachable by anybody else.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer", "admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const includeVoided = url.searchParams.get("include_voided") === "1";

  try {
    const asOf = churchToday(await getSetting("report_timezone"));
    const ledger = await fetchMemberLedger(id, asOf, { includeVoided });

    if (!ledger) return notFound("That member no longer exists.");

    return jsonOk({ found: true, ledger });
  } catch (e) {
    console.error("[treasurer/ledger] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not load this member's ledger.");
  }
}