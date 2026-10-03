import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.object({
  endpoint: z.string().url(),
});

const ALL_ROLES = ["admin", "secretary", "officer", "member", "treasurer", "super_admin"] as const;

/**
 * COM-4: forget this device.
 *
 * Requires a session and matches on role as well as endpoint. A shared family phone is signed out
 * before the next person signs in, and the departing user should not be able to unregister the
 * device the next one just registered.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [...ALL_ROLES]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const sb = getSupabaseAdmin();
  let q = sb
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint)
    .eq("role", g.session.role);

  // Role alone would allow one signed-in secretary to unregister another's device when they share a
  // phone. If the caller has a declared identity, the device must belong to that person.
  if (g.session.actor?.id) q = q.eq("member_id", g.session.actor.id);

  const { error } = await q;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
