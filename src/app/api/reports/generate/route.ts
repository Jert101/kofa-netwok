import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { generateMonthlyReport } from "@/lib/reports/generate";

export const runtime = "nodejs";

const bodySchema = z.object({
  bypass_schedule: z.boolean().optional(),
  /** Default true. Only admins may set false (live data stays until they archive from Past reports). */
  archive_data: z.boolean().optional(),
  session_ids: z.array(z.string().uuid()).min(1, "Select at least one Mass session"),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const err = parsed.error.flatten().fieldErrors.session_ids?.[0] ?? "Invalid request";
    return NextResponse.json({ error: err, code: "VALIDATION" }, { status: 400 });
  }

  const bypass_schedule = parsed.data.bypass_schedule === true;

  if (bypass_schedule && g.session.role !== "admin") {
    return NextResponse.json(
      { error: "Only administrators can bypass the report schedule.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  if (parsed.data.archive_data === false && g.session.role !== "admin") {
    return NextResponse.json(
      { error: "Only administrators can generate a report without archiving.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const archiveAfterGenerate = parsed.data.archive_data !== false;

  const result = await generateMonthlyReport({
    now: new Date(),
    generatedBy: g.session.role as "admin" | "secretary",
    bypassSchedule: bypass_schedule,
    includedSessionIds: parsed.data.session_ids,
    archiveAfterGenerate,
  });

  if (!result.ok) {
    const clientErr =
      result.code === "NOT_ALLOWED_WINDOW" || result.code === "ALREADY_EXISTS";
    const status = clientErr ? 403 : 500;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({ ok: true, reportId: result.reportId });
}
