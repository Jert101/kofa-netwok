import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import {
  buildLiturgySummaryForRange,
  deletePastLiturgyPlanned,
  liturgySummaryTodayUtc,
} from "@/lib/attendance/liturgy-summary";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const qSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  allow_past: z.enum(["0", "1"]).optional(),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["member", "secretary", "admin", "officer"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = qSchema.safeParse({
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
    allow_past: url.searchParams.get("allow_past") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid start or end date" }, { status: 400 });
  }
  if (parsed.data.start > parsed.data.end) {
    return NextResponse.json({ error: "start must be on or before end" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const today = liturgySummaryTodayUtc();
  await deletePastLiturgyPlanned(sb, today);

  const days = await buildLiturgySummaryForRange(sb, parsed.data.start, parsed.data.end, {
    allowPastDates: parsed.data.allow_past === "1",
  });
  return NextResponse.json({ days });
}
