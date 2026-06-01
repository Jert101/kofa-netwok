import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { fetchTopServersData } from "@/lib/reports/top-servers-data";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  try {
    const topServers = await fetchTopServersData();
    return NextResponse.json({ top_servers: topServers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
