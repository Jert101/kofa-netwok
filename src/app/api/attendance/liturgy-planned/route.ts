import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { deleteLiturgyLinkedAnnouncement, notifyLiturgyFromPlanned } from "@/lib/attendance/liturgy-announcement";
import { liturgySlotsBodySchema } from "@/lib/attendance/liturgy-slots";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const qSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mass_id: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = qSchema.safeParse({ date: url.searchParams.get("date"), mass_id: url.searchParams.get("mass_id") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date or mass_id" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: mass, error: mErr } = await sb.from("masses").select("id, name").eq("id", parsed.data.mass_id).maybeSingle();
  if (mErr || !mass) return NextResponse.json({ error: "Mass not found" }, { status: 404 });

  const { data: rows, error } = await sb
    .from("liturgy_planned")
    .select("id, position_label, member_id, free_text, sort_order, members(full_name)")
    .eq("session_date", parsed.data.date)
    .eq("mass_id", parsed.data.mass_id)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const slots = (rows ?? []).map((row) => ({
    id: row.id as string,
    position_label: row.position_label as string,
    member_id: (row.member_id as string | null) ?? null,
    member_name: ((row.members as { full_name?: string } | null)?.full_name ?? "").trim() || null,
    free_text: (row.free_text as string | null) ?? null,
    sort_order: row.sort_order as number,
  }));

  return NextResponse.json({
    session_date: parsed.data.date,
    mass_id: mass.id,
    mass_name: mass.name as string,
    slots,
  });
}

const putBodySchema = liturgySlotsBodySchema.extend({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mass_id: z.string().uuid(),
});

export async function PUT(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = putBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().formErrors[0] ?? parsed.error.message },
      { status: 400 }
    );
  }

  const sb = getSupabaseAdmin();
  const { data: mass, error: mErr } = await sb.from("masses").select("id, name").eq("id", parsed.data.mass_id).maybeSingle();
  if (mErr || !mass) return NextResponse.json({ error: "Mass not found" }, { status: 404 });
  const massName = (mass.name as string) ?? "Mass";

  const memberIds = parsed.data.slots.map((s) => s.member_id).filter((x): x is string => Boolean(x));
  if (memberIds.length) {
    const { data: valid, error: vErr } = await sb.from("members").select("id").in("id", memberIds).eq("is_active", true);
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
    const ok = new Set((valid ?? []).map((r) => r.id as string));
    for (const mid of memberIds) {
      if (!ok.has(mid)) {
        return NextResponse.json({ error: "Invalid or inactive member selected" }, { status: 400 });
      }
    }
  }

  const { error: delErr } = await sb
    .from("liturgy_planned")
    .delete()
    .eq("session_date", parsed.data.session_date)
    .eq("mass_id", parsed.data.mass_id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const now = new Date().toISOString();
  const rows = parsed.data.slots.map((s, i) => ({
    session_date: parsed.data.session_date,
    mass_id: parsed.data.mass_id,
    position_label: s.position_label.trim(),
    member_id: s.member_id,
    free_text: null as string | null,
    sort_order: i,
    updated_at: now,
  }));

  if (rows.length) {
    const { error: insErr } = await sb.from("liturgy_planned").insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await notifyLiturgyFromPlanned(
    sb,
    parsed.data.session_date,
    parsed.data.mass_id,
    massName,
    g.session.role === "officer" && parsed.data.slots.length > 0
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = qSchema.safeParse({ date: url.searchParams.get("date"), mass_id: url.searchParams.get("mass_id") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date or mass_id" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: dErr } = await sb
    .from("liturgy_planned")
    .delete()
    .eq("session_date", parsed.data.date)
    .eq("mass_id", parsed.data.mass_id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const { data: sessions } = await sb
    .from("attendance_sessions")
    .select("id")
    .eq("session_date", parsed.data.date)
    .eq("mass_id", parsed.data.mass_id);
  for (const s of sessions ?? []) {
    await sb.from("session_liturgy_servers").delete().eq("session_id", s.id as string);
  }

  await deleteLiturgyLinkedAnnouncement(sb, parsed.data.date, parsed.data.mass_id);

  return NextResponse.json({ ok: true });
}
