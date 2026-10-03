import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { INBOX_ROLES } from "@/lib/notify/events";

type Ctx = { params: Promise<{ id: string }> };

/**
 * COM-2: mark one message read. The body carries nothing but the read timestamp; the row's owner
 * comes from the session, so a guessed id cannot clear someone else's unread.
 *
 * Replaces the legacy `POST /api/notifications/[id]/read`. The route shape is what the spec says:
 * the id is in the path and the verb is the change being asked for.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), [...INBOX_ROLES]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();

  const { data: row, error: fErr } = await sb
    .from("notifications")
    .select("id")
    .eq("id", id)
    .eq("to_role", g.session.role)
    .maybeSingle();

  if (fErr || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
