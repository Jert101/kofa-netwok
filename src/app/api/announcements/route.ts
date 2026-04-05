import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { broadcastPush } from "@/lib/push/broadcast";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const postSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  delete_at: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary", "member", "officer"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const nowIso = new Date().toISOString();

  let q = sb
    .from("announcements")
    .select("id, title, body, created_by, created_at, delete_at")
    .is("liturgy_session_date", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (mine && (g.session.role === "admin" || g.session.role === "secretary" || g.session.role === "officer")) {
    q = q.eq("created_by", g.session.role);
  } else {
    q = q.or(`delete_at.is.null,delete_at.gt.${nowIso}`);
  }

  const { data, error } = await q;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ announcements: data ?? [] });
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary", "officer"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("announcements").insert({
    title: parsed.data.title,
    body: parsed.data.body,
    created_by: g.session.role,
    delete_at: parsed.data.delete_at ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const preview =
    parsed.data.body.length > 160 ? `${parsed.data.body.slice(0, 157)}…` : parsed.data.body;
  const body =
    g.session.role === "officer"
      ? `[Officer] ${preview}`
      : preview;
  void broadcastPush({
    title: parsed.data.title,
    body,
    url: "/member",
  });

  return NextResponse.json({ ok: true });
}
