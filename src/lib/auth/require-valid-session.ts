import { redirect } from "next/navigation";
import { getSessionFromCookies, type SessionPayload } from "./session";
import { isSessionValidForRole } from "./session-valid";
import { canReach, type Role } from "./roles";

/**
 * Server-component guard for the six role layouts. The edge middleware only
 * checks the signature and the route prefix so it stays fast; this is where a
 * revoked session (AUTH-3) is actually turned away. Redirects to /login.
 *
 * `section` is the namespace being opened, not the role being demanded. A page under `/member` asks
 * for the member section and the cookie decides whether this session may open it, which is what lets
 * the admin and the super admin read and use every other role's pages instead of being bounced off
 * a link their own sidebar just gave them.
 */
export async function requireValidSession(section: Role): Promise<SessionPayload> {
  const session = await getSessionFromCookies();
  if (!session || !canReach(session.role, section)) {
    redirect("/login");
  }
  if (!(await isSessionValidForRole(session))) {
    redirect("/login");
  }
  return session;
}
