import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { churchToday, daysBetween } from "@/lib/time/church-time";

/**
 * DSH-5: the super admin's home.
 *
 * Pending count, the oldest waiting time, and the last three decisions -- which is the whole of what a
 * super admin does in this app. The old page counted the rows the reports route happened to return and
 * called it a pending count; that number was capped by whatever limit that route had, so a queue of
 * fifty could read as three.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  try {
    const asOf = churchToday(await getSetting("report_timezone"));
    const sb = getSupabaseAdmin();

    // A real count, not an array length.
    const { count: pendingCount } = await sb
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    const { data: pending, error } = await sb
      .from("reports")
      .select("id, report_month, title, created_at, generated_by")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);

    const { data: decided, error: decidedError } = await sb
      .from("reports")
      .select("id, report_month, title, status, reviewed_at")
      .in("status", ["approved", "rejected"])
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .limit(3);

    if (error || decidedError) {
      console.error("[dashboard/super-admin] failed:", error?.message ?? decidedError?.message);
      return internalError("Could not load the reports queue.");
    }

    const oldest = pending && pending.length > 0 ? String(pending[0].created_at ?? asOf) : null;

    return jsonOk({
      as_of: asOf,
      pending_count: pendingCount ?? 0,
      oldest_waiting_days: oldest ? Math.max(0, daysBetween(oldest.slice(0, 10), asOf)) : 0,
      oldest_waiting_since: oldest,
      pending: (pending ?? []).slice(0, 10).map((r) => ({
        id: String(r.id),
        title: (r.title as string | null) ?? "Monthly report",
        report_month: String(r.report_month),
        // The column is `generated_by`; this route's output field name stays `submitted_by_role`
        // for its client. It used to select a `submitted_by_role` column on reports, which does not
        // exist, so the super admin's dashboard returned 500 against a real database.
        submitted_by_role: (r.generated_by as string | null) ?? null,
      })),
      last_decisions: (decided ?? []).map((r) => ({
        id: String(r.id),
        title: (r.title as string | null) ?? "Monthly report",
        report_month: String(r.report_month),
        status: String(r.status),
        reviewed_at: (r.reviewed_at as string | null) ?? null,
      })),
      empty: (pendingCount ?? 0) === 0,
    });
  } catch (e) {
    console.error("[dashboard/super-admin] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build your dashboard.");
  }
}