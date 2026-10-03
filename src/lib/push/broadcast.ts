import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getVapidConfig } from "./vapid";
import {
  deadSubscriptionIds,
  selectTargets,
  SUBSCRIPTION_TARGET_COLUMNS,
  type Subscription,
} from "@/lib/notify/targeting";
import type { PushTarget } from "@/lib/notify/events";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

function configureWebPush() {
  const cfg = getVapidConfig();
  if (!cfg) return null;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return cfg;
}

type StoredSub = Subscription & { endpoint: string; p256dh: string; auth: string };

/**
 * COM-3: send a push to the devices a target names, and nobody else's.
 *
 * This replaces the old `broadcastPush`, which was `select * from push_subscriptions` and no
 * further thought. That is how a report approval meant for the super admin used to arrive on every
 * phone in the parish. There is deliberately no function here that sends to everything: a caller
 * that wants everyone has to write `{ everyone: true }`, which is a decision on the record rather
 * than the absence of one.
 *
 * Never throws. Push is best effort by design (spec §COM-3): the request that triggered it must not
 * fail because a push service is down, and a parish that stopped getting notifications because a
 * device is broken is not a parish that stopped working.
 */
export async function sendPushToTarget(target: PushTarget, payload: PushPayload): Promise<void> {
  try {
    if (!configureWebPush()) {
      console.warn("[push] VAPID env not set; skipping push");
      return;
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("push_subscriptions")
      .select(`${SUBSCRIPTION_TARGET_COLUMNS}, endpoint, p256dh, auth`);
    if (error) {
      console.error("[push] subscription query failed", error.message);
      return;
    }
    if (!data?.length) return;

    const all = data as unknown as StoredSub[];
    const chosen = selectTargets(all, target);
    if (chosen.length === 0) return;

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? "/",
    });

    const failures = new Map<string, number | undefined>();

    await Promise.all(
      chosen.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            body,
            { TTL: 86_400 },
          );
        } catch (e: unknown) {
          const status = (e as { statusCode?: number })?.statusCode;
          failures.set(row.id, status);
          if (status !== 404 && status !== 410) {
            console.error("[push] send failed", status, e);
          }
        }
      }),
    );

    // Only 404 and 410 are removed, and only after the whole fan-out. One device failing with a 500
    // keeps its subscription, because deleting on a transient error would unsubscribe the parish
    // whenever the push service had a bad minute.
    const dead = deadSubscriptionIds(chosen, failures);
    if (dead.length > 0) {
      await sb.from("push_subscriptions").delete().in("id", dead);
    }
  } catch (e) {
    console.error("[push] targeted send error", e);
  }
}

/**
 * Send to one device only.
 *
 * COM-4's "Send a test". It deliberately does not go through `selectTargets`, because the point is
 * to prove this device works and nothing about the device's role or topics should be able to stop
 * that.
 */
export async function sendPushToEndpoint(
  endpoint: string,
  keys: { p256dh: string; auth: string },
  payload: PushPayload,
): Promise<{ ok: boolean; removed: boolean; reason?: string }> {
  try {
    if (!configureWebPush()) {
      return { ok: false, removed: false, reason: "Notifications are not configured on this server." };
    }

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? "/",
    });

    try {
      await webpush.sendNotification({ endpoint, keys }, body, { TTL: 300 });
      return { ok: true, removed: false };
    } catch (e: unknown) {
      const status = (e as { statusCode?: number })?.statusCode;
      const dead = status === 404 || status === 410;
      if (dead) {
        const sb = getSupabaseAdmin();
        await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
      } else {
        console.error("[push] test send failed", status, e);
      }
      return {
        ok: false,
        removed: dead,
        reason: dead
          ? "This device's subscription is no longer valid. Turn notifications off and on again."
          : "The push service did not accept the message.",
      };
    }
  } catch (e) {
    console.error("[push] test send error", e);
    return { ok: false, removed: false, reason: "Could not reach the push service." };
  }
}
