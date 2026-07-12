import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { id } = await params;

  let json: unknown = {};
  try { json = await req.json(); } catch { /* empty */ }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { action } = parsed.data;
  const status = action === "approve" ? "approved" : "rejected";

  const sb = getSupabaseAdmin();

  const { data: report } = await sb
    .from("reports")
    .select("id, status, report_month, generated_by")
    .eq("id", id)
    .single();

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  if (report.status !== "pending") {
    return NextResponse.json({ error: "Report is not pending" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error: updErr } = await sb
    .from("reports")
    .update({ status, reviewed_by: "super_admin", reviewed_at: now })
    .eq("id", id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const monthLabel = report.report_month
    ? new Date(report.report_month + "T12:00:00").toLocaleString("en-US", { month: "long", year: "numeric" })
    : "Report";

  const toRole = report.generated_by === "admin" ? "admin" : "secretary";
  await sb.from("notifications").insert({
    from_role: "super_admin",
    to_role: toRole,
    title: action === "approve" ? "Report approved" : "Report rejected",
    body: `${monthLabel} report has been ${action === "approve" ? "approved" : "rejected"} by the super admin.`,
  });

  return NextResponse.json({ ok: true, status });
}