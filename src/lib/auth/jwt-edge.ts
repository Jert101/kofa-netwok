import type { Role } from "./roles";
import { isRole } from "./roles";

function base64UrlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** HS256 JWT verify for Edge middleware (matches `jose` SignJWT output). */
export async function verifySessionTokenEdge(
  token: string,
  secret: string
): Promise<{ role: Role } | null> {
  if (!secret || secret.length < 16) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sigEnc] = parts;
  const data = new TextEncoder().encode(`${h}.${p}`);
  let sig: Uint8Array;
  try {
    sig = base64UrlToBytes(sigEnc);
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify("HMAC", key, new Uint8Array(sig) as BufferSource, data);
  if (!ok) return null;
  let payload: { role?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(p)));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
  if (!isRole(String(payload.role))) return null;
  return { role: payload.role as Role };
}
