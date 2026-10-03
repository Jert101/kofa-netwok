import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { NOTIFY_TOPICS } from "@/lib/notify/events";
import { logAudit } from "@/lib/audit/log-audit";

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  /** Omitted means every topic, which is what the browser asks for on first permission. */
  topics: z.array(z.enum(NOTIFY_TOPICS)).max(NOTIFY_TOPICS.length).optional(),
});

const ALL_ROLES = ["admin", "secretary", "officer", "member", "treasurer", "super_admin"] as const;

/**
 * COM-4: register this device, and record who it belongs to.
 *
 * The role and the member id are not taken from the request. They come from the session cookie,
 * because a request body is a claim and a session is a fact: before this, anyone could POST an
 * endpoint and receive every notification the parish ever sends. Targeting is only as good as the
 * identity behind it.
 *
 * `member_id` is nullable on purpose. A member who has not declared an identity in the parish roll
 * can still be a signed-in member of this app, and refusing them push entirely would be worse than
 * letting their device receive role-scoped messages.
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

  const topics = parsed.data.topics?.length ? parsed.data.topics : [...NOTIFY_TOPICS];

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("push_subscriptions").upsert(
    {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      role: g.session.role,
      member_id: g.session.actor?.id ?? null,
      topics,
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "push_subscription_created",
    entityType: "push_subscription",
    entityId: null,
    meta: { topics },
  });

  return NextResponse.json({ ok: true, topics });
}
