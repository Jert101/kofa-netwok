import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { fetchTopServersData } from "@/lib/reports/top-servers-data";
import { getAllSettings } from "@/lib/settings/store";
import { buildTopServersPdf } from "@/lib/reports/top-servers-pdf";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  try {
    const data = await fetchTopServersData();
    const sorted = data.map((s, idx) => ({
      rank: idx + 1,
      full_name: s.full_name,
      total_served: s.total_served,
    }));

    let churchName = "Knights of the Altar";
    try {
      const settings = await getAllSettings();
      churchName = settings.church_name || churchName;
    } catch {
      // keep fallback
    }

    const pdf = buildTopServersPdf({
      churchName,
      title: "Top 20 Members — Most Masses Served",
      generatedAt: new Date(),
      rows: sorted,
    });

    const body = Buffer.from(pdf);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="top-20-servers.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
