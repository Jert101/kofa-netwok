import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { NAV_GROUPS_BY_ROLE } from "@/lib/nav/config";
import { getSessionFromCookies } from "@/lib/auth/session";
import { isSessionValidForRole } from "@/lib/auth/session-valid";
import { isRole } from "@/lib/auth/roles";

/**
 * COM-4: the shell for a page that every role shares.
 *
 * The six role layouts all call `requireValidSession(section)`, which is right for pages inside a
 * role's namespace but wrong here: this page is not under any role's prefix, so the role to check is
 * the one in the cookie. Same two checks the other layouts make, in the order they make them:
 * signature and existence here, revocation there.
 */
export default async function NotificationsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionFromCookies();
  if (!session || !isRole(session.role)) redirect("/login");
  if (!(await isSessionValidForRole(session))) redirect("/login");

  return (
    <AppShell
      role={session.role}
      groups={NAV_GROUPS_BY_ROLE[session.role]}
      actor={session.actor ?? null}
    >
      {children}
    </AppShell>
  );
}
