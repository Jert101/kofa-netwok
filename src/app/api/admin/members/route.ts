import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { formatMemberFullName } from "@/lib/members/name-format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("all") === "1";

  const sb = getSupabaseAdmin();
  let q = sb.from("members").select("id, full_name, is_active, created_at").order("full_name", { ascending: true });
  if (!includeInactive) {
    q = q.eq("is_active", true);
  }
  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ members: data ?? [] });
}

const postSchema = z.object({
  full_name: z.string().min(1).max(160).trim(),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const full_name = formatMemberFullName(parsed.data.full_name);
  if (!full_name) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("members")
    .insert({ full_name })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An active member with this name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ id: data?.id });
}
