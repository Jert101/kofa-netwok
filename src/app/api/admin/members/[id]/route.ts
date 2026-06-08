import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { formatMemberFullName } from "@/lib/members/name-format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  full_name: z.string().min(1).max(160).trim().optional(),
  is_active: z.boolean().optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  gender: z.enum(["male", "female"]).optional().nullable(),
  contact_number: z.string().max(20).trim().optional().nullable(),
  batch: z.string().regex(/^\d{4}$/).optional().nullable(),
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

  const { full_name, is_active, date_of_birth, gender, contact_number, batch } = parsed.data;

  const updatePayload: Record<string, unknown> = {};
  if (full_name !== undefined) {
    const formatted = formatMemberFullName(full_name);
    if (!formatted) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    updatePayload.full_name = formatted;
  }
  if (is_active !== undefined) updatePayload.is_active = is_active;
  if (date_of_birth !== undefined) updatePayload.date_of_birth = date_of_birth || null;
  if (gender !== undefined) updatePayload.gender = gender || null;
  if (contact_number !== undefined) updatePayload.contact_number = contact_number || null;
  if (batch !== undefined) updatePayload.batch = batch || null;
  updatePayload.updated_at = new Date().toISOString();

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("members")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An active member with this name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
