import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { formatMemberFullName } from "@/lib/members/name-format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  full_name: z.string().min(1).max(160).trim().optional(),
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

  const payload = { ...parsed.data };
  if (payload.full_name !== undefined) {
    const formatted = formatMemberFullName(payload.full_name);
    if (!formatted) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    payload.full_name = formatted;
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("members")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An active member with this name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
