import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();

  const { data, error } = await sb
    .from("attendance_records")
    .select("member_id, members!inner(full_name)")
    .order("member_id", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const countMap = new Map<string, { fullName: string; count: number }>();
  for (const row of data ?? []) {
    const mid = row.member_id as string;
    const m = row.members as { full_name?: string } | null;
    const name = m?.full_name ?? "Unknown";
    const entry = countMap.get(mid);
    if (entry) {
      entry.count++;
    } else {
      countMap.set(mid, { fullName: name, count: 1 });
    }
  }

  const sorted = [...countMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([memberId, { fullName, count }]) => ({
      member_id: memberId,
      full_name: fullName,
      total_served: count,
    }));

  return NextResponse.json({ top_servers: sorted });
}
