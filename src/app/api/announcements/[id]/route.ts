import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const patchSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  delete_at: z.string().datetime().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: row, error: fErr } = await sb
    .from("announcements")
    .select("id, created_by")
    .eq("id", id)
    .maybeSingle();
  if (fErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.created_by !== g.session.role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await sb
    .from("announcements")
    .update({
      title: parsed.data.title,
      body: parsed.data.body,
      delete_at: parsed.data.delete_at ?? null,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;

  const sb = getSupabaseAdmin();
  const { data: row, error: fErr } = await sb
    .from("announcements")
    .select("id, created_by")
    .eq("id", id)
    .maybeSingle();
  if (fErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.created_by !== g.session.role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await sb.from("announcements").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
