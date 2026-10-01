export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const MAX_DEPTH = 6;
const MAX_ARRAY = 200;

/** Keys that must never reach `audit_log.meta`, whatever the caller passes. */
function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === "hash" || k.endsWith("_hash")) return true;
  return (
    k.includes("pin") ||
    k.includes("password") ||
    k.includes("passcode") ||
    k.includes("secret") ||
    k.includes("token") ||
    k.includes("credential")
  );
}

function strip(value: unknown, depth: number): JsonValue | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;

  const t = typeof value;
  if (t === "string" || t === "boolean") return value as JsonValue;
  if (t === "number") return Number.isFinite(value as number) ? (value as number) : undefined;
  if (t === "bigint") return String(value);

  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return undefined;

  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value.slice(0, MAX_ARRAY)) {
      const clean = strip(item, depth + 1);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }

  if (t === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(key)) continue;
      const clean = strip(raw, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  return undefined;
}

/**
 * Strips secret-looking keys from audit metadata. Recurses into nested objects
 * and arrays, caps depth and array length, and drops values that are not JSON.
 * Returns `{}` for anything unusable so `meta` is always a valid object.
 */
export function sanitizeMeta(value: unknown): Record<string, JsonValue> {
  const clean = strip(value, 0);
  if (clean === null || typeof clean !== "object" || Array.isArray(clean)) {
    return {};
  }
  return clean;
}
