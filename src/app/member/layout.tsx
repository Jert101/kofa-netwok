import { AppShell } from "@/components/layout/AppShell";
import { NAV_BY_ROLE } from "@/lib/nav/config";
import { requireValidSession } from "@/lib/auth/require-valid-session";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession("member");
  return (
    <AppShell role="member" links={NAV_BY_ROLE.member} actor={session.actor ?? null}>
      {children}
    </AppShell>
  );
}