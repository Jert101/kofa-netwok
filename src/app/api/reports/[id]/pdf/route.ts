import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readReportPdf } from "@/lib/reports/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Streams a report's PDF.
 *
 * The bytes live in one of two places depending on when the report was generated, so this
 * reads the recorded `pdf_storage_kind` rather than sniffing `pdf_storage_path` — a base64
 * blob and a storage key are indistinguishable from the string alone. See
 * `src/lib/reports/storage.ts`.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary", "super_admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("reports")
    .select("title, pdf_storage_path, pdf_storage_kind, status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not load this report." }, { status: 500 });
  }
  if (!data?.pdf_storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (g.session.role !== "super_admin" && data.status !== "approved") {
    return NextResponse.json({ error: "Report not yet approved" }, { status: 403 });
  }

  const read = await readReportPdf(sb, data.pdf_storage_path as string, data.pdf_storage_kind as string | null);

  if (!read.ok) {
    // A path that is absent and bytes that will not decode are different problems: the first
    // is a legitimately PDF-less report, the second is storage we cannot serve. Only the
    // first is the caller's fault in the sense of deserving a 404.
    const status = read.reason === "missing" ? 404 : 500;
    return NextResponse.json({ error: read.message }, { status });
  }

  const filename = `${(data.title as string) || "report"}.pdf`;
  // Uint8Array rather than the Buffer directly: Buffer<ArrayBufferLike> is not assignable to
  // BodyInit, since that union admits SharedArrayBuffer, which a response body cannot be.
  return new NextResponse(new Uint8Array(read.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      // Private attendance data. Without these a shared machine or proxy could keep a copy
      // after the user has navigated away.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
