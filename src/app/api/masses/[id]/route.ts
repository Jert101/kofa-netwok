import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  default_sunday: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const patch = { ...parsed.data, updated_at: new Date().toISOString() };
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("masses").update(patch).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
