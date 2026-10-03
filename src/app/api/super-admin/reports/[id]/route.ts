import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { badRequest, conflict, internalError, notFound } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/log-audit";
import { notify } from "@/lib/notify/notify";
import { describeRejection, validateReviewNote } from "@/lib/reports/review-reasons";

export const runtime = "nodejs";

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  preset: z.string().nullish(),
  note: z.string().nullish(),
});

/**
 * RPT-3 / spec §7: only `pending -> approved|rejected`, and a rejection carries a reason.
 *
 * The status transition is a conditional UPDATE rather than read-then-write. The previous
 * version read the row, checked it was pending, then wrote — so two reviewers acting at the
 * same moment both read "pending" and both succeeded, leaving two conflicting notifications
 * and no record of which decision was real. With `.eq("status", "pending")` in the WHERE
 * clause exactly one UPDATE matches a row.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { id } = await params;

  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    /* empty body is allowed for approve */
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest("Invalid action.");
  }

  const { action, preset, note } = parsed.data;
  const status = action === "approve" ? "approved" : "rejected";

  // Validated before touching the database, so a rejection without a usable reason is a 400
  // and the report is still pending.
  let reviewNote: string | null = null;
  let described = "";
  if (action === "reject") {
    const check = validateReviewNote({ preset, note });
    if (!check.ok) return badRequest(check.message);
    reviewNote = check.note;
    described = describeRejection(check.preset, check.note);
  }

  const sb = getSupabaseAdmin();

  const { data: report } = await sb
    .from("reports")
    .select("id, status, report_month, generated_by")
    .eq("id", id)
    .maybeSingle();

  if (!report) return notFound("Report not found.");

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await sb
    .from("reports")
    .update({
      status,
      reviewed_by: "super_admin",
      reviewed_at: now,
      // Cleared on approve so a report that was rejected, regenerated and approved does not
      // carry the old rejection reason forward.
      review_note: action === "reject" ? reviewNote : null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, status");

  if (updErr) return internalError(updErr.message);

  if (!updated || updated.length === 0) {
    // Either it was never pending, or another reviewer got there first. Both are the same
    // answer for this caller, and saying so avoids implying their action failed when in
    // fact it landed.
    return conflict(
      "CONFLICT",
      "This report was already reviewed. Reload to see the current decision.",
    );
  }

  const monthLabel = report.report_month
    ? new Date(`${report.report_month}T12:00:00`).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "Report";

  const toRole = report.generated_by === "admin" ? "admin" : "secretary";
  // The reason travels with the notification. RPT-3's complaint was that the secretary had to ask
  // around; a notification without it reproduces the problem in the inbox. It rides as `detail`
  // because the catalog owns the sentence and the shape of the payload, not this route.
  await notify(
    "report_decided",
    {
      role: toRole,
      report_label: monthLabel,
      decision: action === "approve" ? "approved" : "sent back",
      detail: action === "approve" ? undefined : described || "See the report for details.",
    },
    { fromRole: "super_admin" },
  );

  await logAudit({
    action: action === "approve" ? "report_approved" : "report_rejected",
    actor: { role: g.session.role, memberId: null, name: null },
    entityType: "report",
    entityId: id,
    meta: action === "reject" ? { review_note: reviewNote } : {},
    ip: req.headers.get("x-forwarded-for"),
  });

  return NextResponse.json({ ok: true, status, review_note: reviewNote });
}
