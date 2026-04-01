import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const toRole = g.session.role === "admin" ? "admin" : "secretary";
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("notifications")
    .select("id, from_role, to_role, title, body, read_at, created_at")
    .eq("to_role", toRole)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ notifications: data ?? [] });
}

const postSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const toRole = g.session.role === "admin" ? "secretary" : "admin";
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("notifications").insert({
    from_role: g.session.role,
    to_role: toRole,
    title: parsed.data.title,
    body: parsed.data.body ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
