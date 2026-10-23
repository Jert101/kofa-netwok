/**
 * Slack notifications via incoming webhook.
 *
 * Server-only: SLACK_WEBHOOK_URL is never given to the client. Nothing here
 * imports React, and nothing here is exported to a component.
 *
 * Posts a plain-text message to a Slack channel. Returns the result rather
 * than throwing, so a cron run or route handler can keep going when Slack is
 * unreachable.
 */

function webhookUrl(): string {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL is not set");
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
 */
export async function sendSlack(text: string): Promise<SendSlackResult> {
  let res: Response;
  try {
    res = await fetch(webhookUrl(), {
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
