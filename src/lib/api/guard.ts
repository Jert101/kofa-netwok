import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionToken, type SessionPayload } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/roles";

export type GuardResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

export async function requireRole(
  cookieHeader: string | null,
  allowed: Role[]
): Promise<GuardResult> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  const session = token ? await verifySessionToken(token) : null;
  if (!session || !allowed.includes(session.role as Role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, session };
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}
