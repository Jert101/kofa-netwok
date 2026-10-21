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
 *
 * Endpoint: POST https://api.textbee.dev/api/v1/gateway/send-sms
 * Header:   x-api-key: TEXTBEE_API_KEY
 * Body:     { recipients: ["+639xxxxxxxx"], message: "..." }
 *           deviceId is optional; textbee uses the default device when absent.
 */

const API_BASE = "https://api.textbee.dev/api/v1";

function apiKey(): string {
  const key = process.env.TEXTBEE_API_KEY;
  if (!key) throw new Error("TEXTBEE_API_KEY is not set");
  return key;
}

function deviceId(): string | undefined {
  const id = process.env.TEXTBEE_DEVICE_ID;
  return id || undefined;
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
  | { ok: true; batchId: string }
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

  const body: { recipients: string[]; message: string; deviceId?: string } = {
    recipients: [normalized],
    message,
  };
  const id = deviceId();
  if (id) body.deviceId = id;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/gateway/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey(),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const message2 = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not reach textbee: ${message2}` };
  }

  const bodyParsed = (await res.json().catch(() => ({}))) as {
    data?: { success?: boolean; smsBatchId?: string; message?: string; error?: string };
    error?: string;
    message?: string;
  };

  if (res.ok && bodyParsed.data?.success) {
    return { ok: true, batchId: bodyParsed.data.smsBatchId ?? "unknown" };
  }

  return {
    ok: false,
    error:
      bodyParsed.data?.error ??
      bodyParsed.data?.message ??
      bodyParsed.error ??
      bodyParsed.message ??
      `textbee responded ${res.status}`,
  };
}
