import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendPushToEndpoint } from "@/lib/push/broadcast";

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/**
 * COM-4: "Send a test".
 *
 * Goes to the endpoint in the body and nowhere else, bypassing topic filtering on purpose. The
 * question this answers is "can this device display a push at all", and a device that has turned
 * every topic off would otherwise fail the test for the wrong reason.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [
    "admin",
    "secretary",
    "officer",
    "member",
    "treasurer",
    "super_admin",
  ]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // The endpoint/keys must be a subscription this caller actually owns. Without that check, any
  // signed-in user could POST someone else's endpoint and turn this into a push-spam relay.
  {
    let q = getSupabaseAdmin()
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", parsed.data.endpoint)
      .eq("role", g.session.role);
    if (g.session.actor?.id) q = q.eq("member_id", g.session.actor.id);
    const { data } = await q.maybeSingle();
    if (!data) {
      return NextResponse.json({ error: "This device is not subscribed" }, { status: 404 });
    }
  }

  const result = await sendPushToEndpoint(parsed.data.endpoint, parsed.data.keys, {
    title: "Knock knock",
    body: "Notifications are working on this device.",
    url: "/",
  });

  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(
    { ok: false, error: result.reason ?? "Could not send", removed: result.removed },
    { status: 502 },
  );
}
