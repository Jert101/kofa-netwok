/**
 * Slack notifications via incoming webhook.
 *
 * Server-only: SLACK_WEBHOOK_* env vars are never given to the client.
 * Nothing here imports React, and nothing here is exported to a component.
 *
 * Each event type can have its own webhook URL, so birthday greetings,
 * assignment announcements, announcement posts, and deployment status can
 * go to different Slack channels. Falls back to SLACK_WEBHOOK_URL when the
 * event-specific URL is not set.
 */

function webhookUrl(event?: string): string {
  const envKey = `SLACK_WEBHOOK_${event?.toUpperCase() ?? "URL"}`;
  const url = process.env[envKey] ?? process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error(`Slack webhook URL is not set (${envKey})`);
  return url;
}

/** The result of trying to post one message to Slack. */
export type SendSlackResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Post a message to Slack via an incoming webhook.
 *
 * `text` can include Slack markdown (bold with *words*, links with <URL|text>).
 * `event` selects the per-event webhook URL (e.g. "birthday", "assignment",
 * "announcement", "deployment"), falling back to SLACK_WEBHOOK_URL.
 */
export async function sendSlack(text: string, options: { event?: string } = {}): Promise<SendSlackResult> {
  let res: Response;
  try {
    res = await fetch(webhookUrl(options.event), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not reach Slack: ${message}` };
  }

  if (res.ok) return { ok: true };

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: body.error ?? `Slack responded ${res.status}` };
}
