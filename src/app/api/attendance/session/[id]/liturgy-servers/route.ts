import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { liturgySlotsBodySchema } from "@/lib/attendance/liturgy-slots";
import { notifyLiturgyFromSession } from "@/lib/attendance/liturgy-announcement";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  const { id: sessionId } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = liturgySlotsBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().formErrors[0] ?? "Invalid body" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: sess, error: sErr } = await sb
    .from("attendance_sessions")
    .select("id, session_date, mass_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  if (!sess) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const memberIds = parsed.data.slots.map((s) => s.member_id).filter((x): x is string => Boolean(x));
  if (memberIds.length) {
    const { data: valid, error: mErr } = await sb.from("members").select("id").in("id", memberIds).eq("is_active", true);
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
    const ok = new Set((valid ?? []).map((r) => r.id as string));
    for (const mid of memberIds) {
      if (!ok.has(mid)) {
        return NextResponse.json({ error: "Invalid or inactive member selected" }, { status: 400 });
      }
    }
  }

  const { error: delErr } = await sb.from("session_liturgy_servers").delete().eq("session_id", sessionId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const now = new Date().toISOString();
  const rows = parsed.data.slots.map((s, i) => ({
    session_id: sessionId,
    position_label: s.position_label.trim(),
    member_id: s.member_id,
    free_text: null as string | null,
    sort_order: i,
    updated_at: now,
  }));

  if (rows.length) {
    const { error: insErr } = await sb.from("session_liturgy_servers").insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await sb
    .from("liturgy_planned")
    .delete()
    .eq("session_date", String(sess.session_date))
    .eq("mass_id", sess.mass_id as string);

  await notifyLiturgyFromSession(sb, sessionId, g.session.role === "officer" && parsed.data.slots.length > 0);

  return NextResponse.json({ ok: true });
}
