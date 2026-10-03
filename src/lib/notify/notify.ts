import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendPushToTarget } from "@/lib/push/broadcast";
import {
  copyFor,
  inboxRolesFor,
  linkFor,
  pushTargetFor,
  type NotifyEventKey,
  type NotifyPayloads,
} from "./events";

/**
 * What actually happened.
 *
 * Returned rather than thrown, and deliberately boring. `notify` never fails a caller, but the
 * cron jobs that write an audit row saying "we told them" need to know whether the telling
 * happened, otherwise a failed insert is recorded as a reminder that was sent and the report is
 * never nudged again.
 */
export type NotifyResult = {
  /** "skipped" when the event has no inbox recipients, which is most push-only events. */
  inbox: "skipped" | "ok" | "failed";
  /** Whether a push was queued. Never awaited, so this is not a delivery confirmation. */
  push: boolean;
};

/**
 * COM-5: the only way to tell anybody anything.
 *
 * Emitters call `notify("report_pending", {...})` and stop. This function reads the catalog for the
 * copy, the inbox roles, the link and the push target, then does both deliveries. Nothing else in
 * the app builds a notification title or decides recipients.
 *
 * Best effort, in both directions:
 *
 * - It never throws. A route handler that tried to post a registration should not 500 because the
 *   notification insert failed.
 * - Push is not awaited. `notify` is called from request handlers and from crons, and a slow push
 *   service must not hold either up. The promise is caught so it does not become an unhandled
 *   rejection, which would crash the process under Node's default settings.
 * - An inbox insert failure is logged and reported in the result. Losing a row in the inbox is bad;
 *   failing the action the user asked for because of it is worse.
 */
export async function notify<K extends NotifyEventKey>(
  key: K,
  payload: NotifyPayloads[K],
  options: { fromRole?: string | null } = {},
): Promise<NotifyResult> {
  const result: NotifyResult = { inbox: "skipped", push: false };
  try {
    const sb = getSupabaseAdmin();
    const copy = copyFor(key, payload);
    const roles = inboxRolesFor(key, payload);
    const link = linkFor(key, payload);
    const fromRole = options.fromRole ?? "system";

    if (roles.length > 0) {
      const rows = roles.map((role) => ({
        from_role: fromRole,
        to_role: role,
        title: copy.title,
        body: copy.body,
        link,
      }));
      const { error } = await sb.from("notifications").insert(rows);
      if (error) {
        console.error(`[notify] inbox insert failed for ${key}`, error.message);
        result.inbox = "failed";
      } else {
        result.inbox = "ok";
      }
    }

    const target = pushTargetFor(key, payload);
    if (target) {
      result.push = true;
      // Not awaited on purpose; see above. The catch keeps the rejection handled.
      void sendPushToTarget(target, { title: copy.title, body: copy.body, url: link ?? "/" }).catch(
        (e: unknown) => console.error(`[notify] push failed for ${key}`, e),
      );
    }

    return result;
  } catch (e) {
    console.error(`[notify] ${key} failed`, e);
    result.inbox = "failed";
    return result;
  }
}

/**
 * Fire several events without waiting.
 *
 * For emitters that fan out, like the roster change or a copy that touches a dozen people. Same
 * guarantees as `notify`, just not sequenced.
 */
export function notifyAll<K extends NotifyEventKey>(
  events: Array<{ key: K; payload: NotifyPayloads[K] }>,
  options: { fromRole?: string | null } = {},
): void {
  for (const e of events) {
    void notify(e.key, e.payload, options);
  }
}
