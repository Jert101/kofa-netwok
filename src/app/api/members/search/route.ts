import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary", "admin", "member"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const qRaw = (url.searchParams.get("q") ?? "").trim();
  const parsed = z.string().min(1).max(80).safeParse(qRaw);
  if (!parsed.success) {
    return NextResponse.json({ members: [] });
  }

  const escaped = parsed.data.replace(/%/g, "\\%").replace(/_/g, "\\_");
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("members")
    .select("id, full_name")
    .eq("is_active", true)
    .ilike("full_name", `%${escaped}%`)
    .order("full_name", { ascending: true })
    .limit(40);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ members: data ?? [] });
}
