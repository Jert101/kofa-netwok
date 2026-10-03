import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { INBOX_ROLES } from "@/lib/notify/events";

/** COM-2: "Mark all read". Scoped to the caller's own role, so it cannot clear someone else's. */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [...INBOX_ROLES]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("to_role", g.session.role)
    .is("read_at", null)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, marked: data?.length ?? 0 });
}
