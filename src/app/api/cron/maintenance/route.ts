import { LOGIN_ATTEMPTS_RETENTION_DAYS, parseAuditRetentionMonths, retentionCutoff } from "@/lib/maintenance/retention";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import { jsonOk, internalError, unauthenticated } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * AUTH-8 daily sweep. Module 02 leaves the cron entry to module 11.
 *
 * Fails closed when CRON_SECRET is missing. It used to skip the check entirely in
 * that case, which left a route that deletes audit rows reachable by anyone who
 * could guess the URL — and a misconfigured environment is exactly when you least
 * want a stranger running the retention sweep. Refusing loudly is the safe
 * failure: the alternative is deleting history nobody asked to delete.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(
      "[cron/maintenance] CRON_SECRET is not set. Refusing to run the sweep. Set it to a random value.",
    );
    // INTERNAL_ERROR, not UNAUTHENTICATED: nothing is wrong with the caller, the
    // server is misconfigured, and the operator needs it to read that way.
    return internalError("This job is not configured.");
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return unauthenticated("Unauthorized");
  }

  try {
    const sb = getSupabaseAdmin();
    const now = new Date();

    const attemptsCutoff = retentionCutoff(now, LOGIN_ATTEMPTS_RETENTION_DAYS);
    const { error: attemptsError, count: attemptsDeleted } = await sb
      .from("login_attempts")
      .delete({ count: "exact" })
      .lt("attempted_at", attemptsCutoff.toISOString());
    if (attemptsError) throw new Error(`login_attempts: ${attemptsError.message}`);

    const months = parseAuditRetentionMonths(await getSetting("audit_retention_months"));
    const auditCutoff = retentionCutoff(now, months);
    const { error: auditError, count: auditDeleted } = await sb
      .from("audit_log")
      .delete({ count: "exact" })
      .lt("at", auditCutoff.toISOString());
    if (auditError) throw new Error(`audit_log: ${auditError.message}`);

    return jsonOk({
      loginAttemptsDeleted: attemptsDeleted ?? 0,
      auditRowsDeleted: auditDeleted ?? 0,
      auditRetentionMonths: months,
    });
  } catch (e) {
    console.error("[cron/maintenance] sweep failed:", e instanceof Error ? e.message : e);
    return internalError("Sweep failed.");
  }
}

/** Kept so a scheduler can POST as well as GET. Both need the same secret. */
export const POST = GET;
