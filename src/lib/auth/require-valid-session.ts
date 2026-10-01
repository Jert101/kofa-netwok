import { redirect } from "next/navigation";
import { getSessionFromCookies, type SessionPayload } from "./session";
import { isSessionValidForRole } from "./session-valid";
import type { Role } from "./roles";

/**
 * Server-component guard for the six role layouts. The edge middleware only
 * checks the signature and the route prefix so it stays fast; this is where a
 * revoked session (AUTH-3) is actually turned away. Redirects to /login.
 */
export async function requireValidSession(expected: Role): Promise<SessionPayload> {
  const session = await getSessionFromCookies();
  if (!session || session.role !== expected) {
    redirect("/login");
  }
  if (!(await isSessionValidForRole(session))) {
    redirect("/login");
  }
  return session;
}
