import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { copyPlannedLiturgyToSession } from "@/lib/attendance/copy-planned-liturgy";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const postSchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mass_id: z.string().uuid(),
  member_ids: z.array(z.string().uuid()).default([]),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary"]);
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

  const unique = [...new Set(parsed.data.member_ids)];
  const sb = getSupabaseAdmin();

  const { data: mass, error: mErr } = await sb.from("masses").select("id").eq("id", parsed.data.mass_id).maybeSingle();
  if (mErr || !mass) {
    return NextResponse.json({ error: "Invalid mass" }, { status: 400 });
  }

  const { data: created, error: cErr } = await sb
    .from("attendance_sessions")
    .insert({
      session_date: parsed.data.session_date,
      mass_id: parsed.data.mass_id,
    })
    .select("id")
    .single();

  if (cErr || !created) {
    return NextResponse.json({ error: cErr?.message ?? "Create failed" }, { status: 500 });
  }

  const id = created.id as string;

  await copyPlannedLiturgyToSession(sb, id, parsed.data.session_date, parsed.data.mass_id);

  if (unique.length) {
    const rows = unique.map((member_id) => ({ session_id: id, member_id }));
    const { error: iErr } = await sb.from("attendance_records").insert(rows);
    if (iErr) {
      await sb.from("attendance_sessions").delete().eq("id", id);
      return NextResponse.json({ error: iErr.message }, { status: 400 });
    }
  }

  void notifyAttendanceSessionUpdated(id);

  return NextResponse.json({ id });
}
