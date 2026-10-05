import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionToken, type SessionPayload } from "@/lib/auth/session";
import { isSessionValidForRole } from "@/lib/auth/session-valid";
import { canReach, type Role } from "@/lib/auth/roles";

export type GuardResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

/**
 * A route declares the roles it is *for*; this decides who may actually call it.
 *
 * A session may act as any role it can reach, so `["treasurer"]` also answers to the admin and the
 * super admin, and `["admin"]` also answers to the super admin. That is what makes an overseer's
 * sidebar link land on a working page rather than a 401: the page under `/treasurer` fetches
 * `/api/dashboard/treasurer`, which is declared `["treasurer"]`.
 *
 * The reach table does the work rather than a blanket "admit every overseer", so the one route a role
 * may not borrow stays closed: `admin` cannot reach `super_admin`, which keeps
 * `/api/super-admin/reports/[id]` -- the report-approval gate -- answerable only by the role that owns it.
 *
 * Reach is the right default for *reading and for doing the work a page offers*, but a handful of
 * actions belong to one role by specification and must not be borrowed. Those routes pass
 * `{ selfOnly: true }`, which admits the session's own role and nothing it reaches. Today that is
 * `/api/treasurer/payments/[id]/void` (spec §PAY-3: the admin may record a payment but may not reverse
 * one). The flag is opt-in and per-route, so each exception is visible at the call site instead of
 * being inferred from a table someone has to remember.
 */
export type GuardOptions = {
  /**
   * Admit only the session's own role, ignoring what it reaches. Use for an action the spec reserves
   * to one role; leave it off so the pages an admin opens stay functional.
   */
  selfOnly?: boolean;
};

/**
 * The pure authorization decision, kept separate from token verification so it can be tested directly.
 */
export function roleAllowed(sessionRole: Role, allowed: Role[], selfOnly = false): boolean {
  return selfOnly ? allowed.includes(sessionRole) : allowed.some((role) => canReach(sessionRole, role));
}

export async function requireRole(
  cookieHeader: string | null,
  allowed: Role[],
  options: GuardOptions = {}
): Promise<GuardResult> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  const session = token ? await verifySessionToken(token) : null;
  if (!session || !roleAllowed(session.role as Role, allowed, options.selfOnly)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  // AUTH-3: a PIN change or "sign out all devices" invalidates older cookies.
  if (!(await isSessionValidForRole(session))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Session expired" }, { status: 401 }),
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
