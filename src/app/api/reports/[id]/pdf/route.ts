import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("reports").select("title, pdf_storage_path").eq("id", id).maybeSingle();

  if (error || !data?.pdf_storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buf = Buffer.from(data.pdf_storage_path as string, "base64");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${encodeURIComponent((data.title as string) || "report")}.pdf"`,
    },
  });
}
