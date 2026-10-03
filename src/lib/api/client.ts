import type { ApiError, ApiFailure, ApiSuccess } from "./response";

/**
 * Reading the API from the browser.
 *
 * Every route that uses `jsonOk` / `jsonError` answers with an envelope:
 *
 *   success  { ok: true,  data: <payload> }
 *   failure  { ok: false, error: { code, message, fields? } }
 *
 * so the payload is under `data` and the text is under `error.message`. Casting the parsed body to
 * whatever fields the caller happens to want is the single most reliable way to write a screen that
 * silently renders nothing: the cast compiles, `tsc` is happy, lint is happy, unit tests never touch
 * a real fetch, and the page comes up empty with a 200 and no error anywhere. That bug shipped once
 * already and emptied six screens at the same time, which is why the read lives here instead of
 * being re-guessed at each call site.
 *
 * Use this only for enveloped routes. A few older routes answer with a bare `NextResponse.json`, and
 * for those the body *is* the payload -- wrapping those with this helper would hide the data.
 */
export type Envelope<T> = ApiSuccess<T> | ApiFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parses an enveloped response. Returns null when the body is not JSON, or is JSON that does not
 * carry an `ok` flag -- callers then have to decide what an unrecognised body means rather than
 * silently receiving undefined fields.
 */
export async function readEnvelope<T>(res: Response): Promise<Envelope<T> | null> {
  const body: unknown = await res.json().catch(() => null);
  if (!isRecord(body)) return null;
  if (body.ok === true) return { ok: true, data: body.data as T };
  if (body.ok === false) return { ok: false, error: body.error as ApiError };
  return null;
}

/** The payload of a successful enveloped response, or null. */
export function dataOf<T>(env: Envelope<T> | null): T | null {
  return env && env.ok ? env.data : null;
}

/**
 * The message to show a person. Prefers the server's wording, because it is the one that knows why
 * (a locked month, a Mass that has not happened yet, a Mass that was deactivated).
 */
export function messageOf(env: Envelope<unknown> | null, fallback: string): string {
  if (env && !env.ok) {
    const message = env.error?.message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

/** One machine-readable extra from a failure, e.g. `existing_session_id`. */
export function fieldOf(env: Envelope<unknown> | null, key: string): string | undefined {
  if (env && !env.ok) {
    const value = env.error?.fields?.[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}