import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getVapidConfig } from "./vapid";

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

/**
 * Sends a web push to all stored subscriptions. Removes dead endpoints (410/404).
 * Fire-and-forget from route handlers; errors are logged, not thrown to clients.
 */
export async function broadcastPush(payload: PushPayload): Promise<void> {
  try {
    if (!configureWebPush()) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[push] VAPID env not set; skipping broadcast");
      }
      return;
    }

    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth");
    if (error || !rows?.length) return;

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? "/",
    });

    const deadIds: string[] = [];

    await Promise.all(
      rows.map(async (row) => {
        const sub = {
          endpoint: row.endpoint as string,
          keys: { p256dh: row.p256dh as string, auth: row.auth as string },
        };
        try {
          await webpush.sendNotification(sub, body, { TTL: 86_400 });
        } catch (e: unknown) {
          const status = (e as { statusCode?: number })?.statusCode;
          if (status === 410 || status === 404) {
            deadIds.push(row.id as string);
          } else if (process.env.NODE_ENV === "development") {
            console.warn("[push] send failed", status, e);
          }
        }
      })
    );

    if (deadIds.length) {
      await sb.from("push_subscriptions").delete().in("id", deadIds);
    }
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[push] broadcast error", e);
    }
  }
}
