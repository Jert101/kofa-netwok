/**
 * Where to send someone after they sign in.
 *
 * Middleware bounces an unauthenticated request to `/login?next=<where they were going>`, so a
 * deep link survives the detour through the sign-in form. That makes the value attacker-controlled:
 * it arrives in a query string and is handed to `router.replace`, so a value like `//evil.example`
 * would navigate off-site and `https://evil.example` is not even a path at all.
 *
 * The rules are therefore "same site, and not the sign-in page itself": anything else falls back
 * rather than being sanitised into something that still looks like a deep link.
 */
export function safeNextPath(
  raw: string | string[] | undefined | null,
  fallback = "",
): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/")) return fallback;
  // "//host" and "/\host" are protocol-relative URLs, not local paths.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Back to the sign-in page is the loop this whole mechanism has to avoid.
  const path = value.split("?")[0].split("#")[0];
  if (path === "/login" || path === "/register") return fallback;
  return value;
}