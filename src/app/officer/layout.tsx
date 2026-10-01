import { AppShell } from "@/components/layout/AppShell";
import { NAV_BY_ROLE } from "@/lib/nav/config";
import { requireValidSession } from "@/lib/auth/require-valid-session";

export default async function OfficerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession("officer");
  return (
    <AppShell role="officer" links={NAV_BY_ROLE.officer} actor={session.actor ?? null}>
      {children}
    </AppShell>
  );
}