/**
 * SMS through textbee.dev, using the parish's own Android phone (DITO SIM).
 *
 * Server-only: TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID are never given to the
 * client. Nothing here imports React, and nothing here is exported to a
 * component.
 *
 * The free plan allows 50 messages per day, so the cron runner decides how
 * many to send each time. This module only knows how to send one message and
 * how to turn a Philippine phone number into the +63 format textbee expects.
 */

const API_BASE = "https://api.textbee.dev/api/devices";

function deviceId(): string {
  const id = process.env.TEXTBEE_DEVICE_ID;
  if (!id) throw new Error("TEXTBEE_DEVICE_ID is not set");
  return id;
}

function apiKey(): string {
  const key = process.env.TEXTBEE_API_KEY;
  if (!key) throw new Error("TEXTBEE_API_KEY is not set");
  return key;
}

/**
 * Turn a Philippine phone number into +63 format.
 *
 * Accepts:
 *   09171234567      -> +639171234567
 *   +639171234567    -> +639171234567
 *   639171234567     -> +639171234567
 *   0917-123-4567    -> +639171234567
 *   (0917) 123-4567  -> +639171234567
 *
 * Returns null when it cannot be read as a valid Philippine mobile number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Keep only digits and a leading plus.
  let digits = raw.trim().replace(/^\+/, "").replace(/\D/g, "");

  // Strip a leading trunk zero.
  if (digits.startsWith("0")) digits = digits.slice(1);

  // Strip a leading country code.
  if (digits.startsWith("63")) digits = digits.slice(2);

  // A Philippine mobile number is 10 digits after the country code.
  if (!/^9\d{9}$/.test(digits)) return null;

  return `+63${digits}`;
}

/** The result of trying to send one text message. */
export type SendSmsResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/**
 * Send one text message through textbee.dev.
 *
 * Returns the result rather than throwing, so a cron run that sends a batch
 * can keep going when one number rejects the message.
 */
export async function sendSms(to: string, message: string): Promise<SendSmsResult> {
  const normalized = normalizePhone(to);
  if (!normalized) {
    return { ok: false, error: `Invalid Philippine number: ${to}` };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${deviceId()}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-token": apiKey(),
      },
      body: JSON.stringify({ recipients: [normalized], message }),
    });
  } catch (e) {
    const message2 = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not reach textbee: ${message2}` };
  }

  const body = (await res.json().catch(() => ({}))) as {
    data?: { message_id?: string };
    error?: string;
    message?: string;
  };

  if (res.ok) {
    return { ok: true, messageId: body.data?.message_id ?? "unknown" };
  }

  return { ok: false, error: body.error ?? body.message ?? `textbee responded ${res.status}` };
}
