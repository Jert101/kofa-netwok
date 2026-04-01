import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { archiveLiveDataForReport } from "@/lib/reports/archive-month";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const result = await archiveLiveDataForReport(id);

  if (!result.ok) {
    const notFound = result.message.includes("not found");
    return NextResponse.json({ error: result.message }, { status: notFound ? 404 : 500 });
  }

  return NextResponse.json({ ok: true });
}
