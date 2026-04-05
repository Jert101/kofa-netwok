import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/api/guard";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

async function pruneEmptyAppealParents(sb: SupabaseClient, appealIds: string[]) {
  const unique = [...new Set(appealIds.filter(Boolean))];
  for (const appealId of unique) {
    const { count, error } = await sb
      .from("attendance_appeal_items")
      .select("id", { count: "exact", head: true })
      .eq("appeal_id", appealId);
    if (error) continue;
    if ((count ?? 0) === 0) {
      await sb.from("attendance_appeals").delete().eq("id", appealId);
    }
  }
}

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

  const appealId = item.appeal_id as string;

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
    if (saErr) return NextResponse.json({ error: saErr.message }, { status: 500 });
    const sessionAppealIds = (sessionAppeals ?? []).map((r) => r.id as string);
    if (sessionAppealIds.length === 0) {
      return NextResponse.json({ error: "Missing appeal context" }, { status: 500 });
    }

    const { data: pendingItems, error: piErr } = await sb
      .from("attendance_appeal_items")
      .select("id, appeal_id")
      .in("appeal_id", sessionAppealIds)
      .eq("member_id", item.member_id as string)
      .eq("status", "pending");
    if (piErr) return NextResponse.json({ error: piErr.message }, { status: 500 });

    const ids = (pendingItems ?? []).map((r) => r.id as string);
    const affectedAppealIds = (pendingItems ?? []).map((r) => r.appeal_id as string);
    if (ids.length === 0) {
      return NextResponse.json({ error: "No pending appeal rows to resolve" }, { status: 409 });
    }

    const { error: dErr } = await sb.from("attendance_appeal_items").delete().in("id", ids);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

    await pruneEmptyAppealParents(sb, affectedAppealIds);
    void notifyAttendanceSessionUpdated(sessionId);
    return NextResponse.json({ ok: true });
  }

  const { error: dErr } = await sb.from("attendance_appeal_items").delete().eq("id", id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  await pruneEmptyAppealParents(sb, [appealId]);
  return NextResponse.json({ ok: true });
}
