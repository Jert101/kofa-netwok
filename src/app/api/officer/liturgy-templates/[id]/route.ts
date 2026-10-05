import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asGenderRule, validateTemplateName, validateTemplatePositions } from "@/lib/liturgy/rules";
import { logAudit } from "@/lib/audit/log-audit";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  position_labels: z
    .array(z.union([z.string(), z.object({
      position_label: z.string(),
      required_gender: z.enum(["male", "female", "any"]).optional(),
    })]))
    .min(1)
    .optional(),
});

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();

  const { data: template, error: tErr } = await sb
    .from("liturgy_templates")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { data: slots, error: sErr } = await sb
    .from("liturgy_template_slots")
    .select("position_label, required_gender")
    .eq("template_id", id)
    .order("sort_order", { ascending: true });

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const positions = (slots ?? []).map((s) => ({
    position_label: s.position_label as string,
    // Read through `asGenderRule` so a stray value reads as "any" rather than surfacing junk.
    required_gender: asGenderRule(s.required_gender),
  }));

  return NextResponse.json({
    id: template.id as string,
    name: template.name as string,
    // `position_labels` is kept for the plan editor's TemplateBar, which only wants the strings.
    position_labels: positions.map((p) => p.position_label),
    positions,
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();

  // Read the name before the delete so the audit trail records which template went, not just an id.
  const { data: existing } = await sb.from("liturgy_templates").select("name").eq("id", id).maybeSingle();

  const { error } = await sb.from("liturgy_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    action: "liturgy_template_deleted",
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    entityType: "liturgy_templates",
    entityId: id,
    meta: { name: existing?.name ?? null },
    ip: req.headers.get("x-forwarded-for"),
  });

  return NextResponse.json({ ok: true });
}

/**
 * LIT-4: rename a template.
 *
 * Validation is the shared `validateTemplateName`, not a bare `.min(1)`, so a name made only of
 * spaces or a long one fails here with the same message the editor shows before it ever reaches
 * the server.
 *
 * The uniqueness index from migration 030 is on `lower(btrim(name))`, which means Postgres returns
 * error 23505 for "Weekday" vs "weekday". Surfacing that as a duplicate-name message rather than a
 * 500 matters: renaming a case is a normal thing to do and the officer cannot act on
 * `duplicate key value violates unique constraint`.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
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
    return NextResponse.json(
      { error: parsed.error.flatten().formErrors[0] ?? parsed.error.message },
      { status: 400 },
    );
  }
  if (parsed.data.name === undefined && parsed.data.position_labels === undefined) {
    return NextResponse.json({ error: "Send a name or position_labels to update." }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: existing, error: readErr } = await sb
    .from("liturgy_templates")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Rename and re-position are independent; rename updates the row, positions replaces the slots.
  // Both are done in one PATCH so a single edit can carry the whole change.
  if (parsed.data.name !== undefined) {
    const name = validateTemplateName(parsed.data.name);
    if (!name.ok) {
      return NextResponse.json({ error: name.message }, { status: 400 });
    }
    const { error } = await sb
      .from("liturgy_templates")
      .update({ name: name.name })
      .eq("id", id);
    if (error) {
      const duplicate = error.code === "23505";
      return NextResponse.json(
        { error: duplicate ? `A template called “${name.name}” already exists.` : error.message },
        { status: duplicate ? 409 : 500 },
      );
    }
    await logAudit({
      action: "liturgy_template_renamed",
      actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
      entityType: "liturgy_templates",
      entityId: id,
      meta: { from: existing.name, to: name.name },
      ip: req.headers.get("x-forwarded-for"),
    });
  }

  if (parsed.data.position_labels !== undefined) {
    const validated = validateTemplatePositions(parsed.data.position_labels);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.message }, { status: 400 });
    }
    const { error: delErr } = await sb.from("liturgy_template_slots").delete().eq("template_id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const rows = validated.positions.map((p, i) => ({
      template_id: id,
      position_label: p.position_label,
      required_gender: p.required_gender,
      sort_order: i,
    }));
    const { error: insErr } = await sb.from("liturgy_template_slots").insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const { data: finalTemplate } = await sb
    .from("liturgy_templates")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  return NextResponse.json({ id: finalTemplate?.id as string, name: finalTemplate?.name as string });
}
