import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["member", "secretary", "admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();
  const { data: session, error } = await sb
    .from("attendance_sessions")
    .select("id, session_date, mass_id, notes, masses(name)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: records, error: rErr } = await sb
    .from("attendance_records")
    .select("member_id, members(full_name)")
    .eq("session_id", id)
    .order("created_at", { ascending: true });

  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }

  const rawMembers = (records ?? []).map((r) => ({
    member_id: r.member_id as string,
    full_name: (r.members as { full_name?: string } | null)?.full_name ?? "",
  }));
  const seen = new Set<string>();
  const members = rawMembers.filter((m) => {
    if (!m.member_id || seen.has(m.member_id)) return false;
    seen.add(m.member_id);
    return true;
  });

  const payload: Record<string, unknown> = {
    session: {
      id: session.id,
      session_date: session.session_date,
      mass_id: session.mass_id as string,
      mass_name: (session.masses as { name?: string } | null)?.name ?? "Mass",
      notes: session.notes,
    },
    members,
  };

  if (g.session.role === "member") {
    const cannotAppeal = new Set(members.map((m) => m.member_id));
    const { data: pendingRows, error: pErr } = await sb
      .from("attendance_appeal_items")
      .select("member_id, attendance_appeals!inner(session_id)")
      .eq("attendance_appeals.session_id", id)
      .eq("status", "pending");
    if (!pErr && pendingRows?.length) {
      for (const row of pendingRows) {
        cannotAppeal.add(row.member_id as string);
      }
    }
    payload.member_ids_cannot_appeal = [...cannotAppeal];
  }

  return NextResponse.json(payload);
}

const patchSchema = z.object({
  member_ids: z.array(z.string().uuid()),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary"]);
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

  const unique = [...new Set(parsed.data.member_ids)];
  const sb = getSupabaseAdmin();

  const { data: session, error: sErr } = await sb.from("attendance_sessions").select("id").eq("id", id).maybeSingle();
  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await sb.from("attendance_records").delete().eq("session_id", id);

  if (unique.length) {
    const rows = unique.map((member_id) => ({ session_id: id, member_id }));
    const { error: iErr } = await sb.from("attendance_records").insert(rows);
    if (iErr) {
      if (iErr.code === "23505") {
        return NextResponse.json({ error: "Duplicate member in session" }, { status: 409 });
      }
      return NextResponse.json({ error: iErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("attendance_sessions").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
