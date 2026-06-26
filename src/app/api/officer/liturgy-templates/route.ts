import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  position_labels: z.array(z.string().min(1)).min(1),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("liturgy_templates")
    .select("id, name, created_by, created_at")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const templates = await Promise.all(
    (data ?? []).map(async (t) => {
      const { count } = await sb
        .from("liturgy_template_slots")
        .select("*", { count: "exact", head: true })
        .eq("template_id", t.id);
      return {
        id: t.id as string,
        name: t.name as string,
        slot_count: count ?? 0,
        created_at: t.created_at as string,
      };
    })
  );

  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().formErrors[0] ?? parsed.error.message },
      { status: 400 }
    );
  }

  const sb = getSupabaseAdmin();
  const { data: template, error: tErr } = await sb
    .from("liturgy_templates")
    .insert({ name: parsed.data.name, created_by: g.session.role })
    .select("id, name")
    .single();

  if (tErr || !template) {
    return NextResponse.json({ error: tErr?.message ?? "Could not create template" }, { status: 500 });
  }

  const slots = parsed.data.position_labels.map((label, i) => ({
    template_id: template.id,
    position_label: label,
    sort_order: i,
  }));

  const { error: sErr } = await sb.from("liturgy_template_slots").insert(slots);
  if (sErr) {
    await sb.from("liturgy_templates").delete().eq("id", template.id);
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  return NextResponse.json({
    id: template.id as string,
    name: template.name as string,
    slot_count: slots.length,
  });
}
