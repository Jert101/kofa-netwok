import { createHmac } from "node:crypto";

/**
 * Salt for hashing client IPs. IP_HASH_SALT is preferred; JWT_SECRET is the
 * fallback so an existing deployment works without extra configuration. Without
 * either we return null and callers store no ip_hash rather than an unsalted one.
 */
export function ipHashSalt(): string | null {
  const salt = process.env.IP_HASH_SALT || process.env.JWT_SECRET;
  return salt && salt.length > 0 ? salt : null;
}

/** Salted, one-way hash of a client IP. Never store or log the raw address. */
export function hashIp(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(ip).digest("hex");
}

/** Convenience wrapper that resolves the salt itself. */
export function ipHashFor(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = ipHashSalt();
  return salt ? hashIp(ip, salt) : null;
}

/** First value of x-forwarded-for, which is the client on Vercel. */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || null;
}
