import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const postSchema = z.object({
  member_ids: z.array(z.string().uuid()).min(1).max(40),
});

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const { id: sessionId } = await ctx.params;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("attendance_appeal_items")
    .select(
      "id, member_id, status, reviewed_by_role, reviewed_at, created_at, members(full_name), attendance_appeals!inner(session_id, submitted_at)"
    )
    .eq("attendance_appeals.session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const appealsRaw = (data ?? []).map((row) => ({
    id: row.id as string,
    member_id: row.member_id as string,
    member_name: ((row.members as { full_name?: string } | null)?.full_name ?? "").trim(),
    status: (row.status as "pending" | "approved" | "rejected") ?? "pending",
    reviewed_by_role: (row.reviewed_by_role as "admin" | "secretary" | null) ?? null,
    reviewed_at: (row.reviewed_at as string | null) ?? null,
    created_at: row.created_at as string,
    submitted_at:
      ((row.attendance_appeals as { submitted_at?: string } | null)?.submitted_at as string | undefined) ?? null,
  }));

  const sorted = [...appealsRaw].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const byMember = new Map<string, (typeof appealsRaw)[0]>();
  for (const x of sorted) {
    if (x.status === "pending" && !byMember.has(x.member_id)) {
      byMember.set(x.member_id, x);
    }
  }
  for (const x of sorted) {
    if (!byMember.has(x.member_id)) {
      byMember.set(x.member_id, x);
    }
  }
  const appeals = Array.from(byMember.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return NextResponse.json({ appeals });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["member"]);
  if (!g.ok) return g.response;

  const { id: sessionId } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: session, error: sErr } = await sb.from("attendance_sessions").select("id").eq("id", sessionId).maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const uniqueMemberIds = [...new Set(parsed.data.member_ids)];
  const { data: existingRecords, error: rErr } = await sb
    .from("attendance_records")
    .select("member_id")
    .eq("session_id", sessionId)
    .in("member_id", uniqueMemberIds);
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  const onRoster = new Set((existingRecords ?? []).map((r) => r.member_id as string));

  const { data: pendingAppealRows, error: pErr } = await sb
    .from("attendance_appeal_items")
    .select("member_id, attendance_appeals!inner(session_id)")
    .eq("attendance_appeals.session_id", sessionId)
    .eq("status", "pending")
    .in("member_id", uniqueMemberIds);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const pendingAppeal = new Set((pendingAppealRows ?? []).map((r) => r.member_id as string));

  const toAppeal = uniqueMemberIds.filter((id) => !onRoster.has(id) && !pendingAppeal.has(id));
  if (toAppeal.length !== uniqueMemberIds.length) {
    return NextResponse.json(
      {
        error:
          "One or more selected names are already on the attendance list or already have a pending appeal for this Mass.",
      },
      { status: 400 }
    );
  }

  const { data: appeal, error: aErr } = await sb
    .from("attendance_appeals")
    .insert({ session_id: sessionId, submitted_by_role: g.session.role })
    .select("id")
    .single();
  if (aErr || !appeal) return NextResponse.json({ error: aErr?.message ?? "Could not submit appeal" }, { status: 500 });

  const { error: iErr } = await sb.from("attendance_appeal_items").insert(
    toAppeal.map((memberId) => ({
      appeal_id: appeal.id as string,
      member_id: memberId,
    }))
  );
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, appeal_id: appeal.id, submitted_count: toAppeal.length });
}
