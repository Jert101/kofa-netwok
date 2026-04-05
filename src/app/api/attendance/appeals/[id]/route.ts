import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: item, error: fErr } = await sb
    .from("attendance_appeal_items")
    .select("id, appeal_id, member_id, status, attendance_appeals!inner(session_id)")
    .eq("id", id)
    .maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Appeal item not found" }, { status: 404 });
  if ((item.status as string) !== "pending") {
    return NextResponse.json({ error: "Appeal item already reviewed" }, { status: 400 });
  }

  const sessionId =
    ((item.attendance_appeals as { session_id?: string } | null)?.session_id as string | undefined) ?? null;
  if (!sessionId) return NextResponse.json({ error: "Missing session context" }, { status: 500 });

  const reviewedAt = new Date().toISOString();

  if (parsed.data.action === "approve") {
    const { error: upErr } = await sb.from("attendance_records").upsert(
      [{ session_id: sessionId, member_id: item.member_id as string }],
      { onConflict: "session_id,member_id", ignoreDuplicates: true }
    );
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data: sessionAppeals, error: saErr } = await sb
      .from("attendance_appeals")
      .select("id")
      .eq("session_id", sessionId);
    if (!saErr && sessionAppeals?.length) {
      const appealIds = sessionAppeals.map((r) => r.id as string);
      await sb
        .from("attendance_appeal_items")
        .update({
          status: "rejected",
          reviewed_by_role: g.session.role,
          reviewed_at: reviewedAt,
        })
        .in("appeal_id", appealIds)
        .eq("member_id", item.member_id as string)
        .eq("status", "pending")
        .neq("id", id);
    }
  }

  const { error: uErr } = await sb
    .from("attendance_appeal_items")
    .update({
      status: parsed.data.action === "approve" ? "approved" : "rejected",
      reviewed_by_role: g.session.role,
      reviewed_at: reviewedAt,
    })
    .eq("id", id);

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
