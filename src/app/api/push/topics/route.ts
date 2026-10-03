import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { NOTIFY_TOPICS } from "@/lib/notify/events";

const ALL_ROLES = ["admin", "secretary", "officer", "member", "treasurer", "super_admin"] as const;

const bodySchema = z.object({
  endpoint: z.string().url(),
  topics: z.array(z.enum(NOTIFY_TOPICS)).max(NOTIFY_TOPICS.length),
});

/**
 * What this device has stored, so the settings page shows the truth rather than what localStorage
 * last believed. `Notification.permission` answers whether the browser will allow a push; it says
 * nothing about what the server has on file, and the two disagree whenever a subscription was made
 * on another tab or the database was swept.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [...ALL_ROLES]);
  if (!g.ok) return g.response;

  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });

  const sb = getSupabaseAdmin();
  let q = sb
    .from("push_subscriptions")
    .select("topics, role, member_id")
    .eq("endpoint", endpoint)
    .eq("role", g.session.role);

  // If the caller has a declared identity, the device must belong to that same person — role alone
  // would let one signed-in secretary retune another secretary's phone.
  if (g.session.actor?.id) q = q.eq("member_id", g.session.actor.id);

  const { data, error } = await q.maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This device is not subscribed" }, { status: 404 });

  return NextResponse.json({
    topics: data.topics ?? [],
    role: data.role,
    identity_recorded: Boolean(data.member_id),
  });
}

/**
 * COM-4: change which topics this device accepts.
 *
 * Its own endpoint rather than a PATCH on subscribe, because the settings page calls this on every
 * toggle and the browser has no new key material at that moment. Re-subscribing would work but would
 * churn the audit log and briefly risk the device if the browser silently refused the prompt.
 *
 * The role predicate is deliberate: one signed-in user cannot retune somebody else's device by
 * guessing an endpoint from a shared machine's history.
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
    .update({ topics: parsed.data.topics })
    .eq("endpoint", parsed.data.endpoint)
    .eq("role", g.session.role);

  if (g.session.actor?.id) q = q.eq("member_id", g.session.actor.id);

  const { data, error } = await q.select("endpoint");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    // No row is a real answer rather than a silent success: the caller is holding a stale endpoint
    // from localStorage, and telling it so is how the page recovers.
    return NextResponse.json({ error: "This device is not subscribed" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, topics: parsed.data.topics });
}
