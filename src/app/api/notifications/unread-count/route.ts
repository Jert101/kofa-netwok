import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { INBOX_ROLES } from "@/lib/notify/events";

/**
 * COM-6: the number on the bell.
 *
 * Deliberately a `head: true` count with no rows, because the sidebar asks for this on every page
 * load and every focus, and returning the rows would move fifty notifications across the network
 * sixty times a session just to draw a digit.
 *
 * `role` rather than `member_id` because the existing `notifications` table is addressed by role.
 * Per-person inbox is module 11's problem, and this module's job is to stop pretending the badge
 * does not exist.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [...INBOX_ROLES]);
  if (!g.ok) return g.response;

  const { count, error } = await getSupabaseAdmin()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("to_role", g.session.role)
    .is("read_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ unread: count ?? 0 });
}
