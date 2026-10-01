import { AppShell } from "@/components/layout/AppShell";
import { NAV_BY_ROLE } from "@/lib/nav/config";
import { requireValidSession } from "@/lib/auth/require-valid-session";

export default async function TreasurerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession("treasurer");
  return (
    <AppShell role="treasurer" links={NAV_BY_ROLE.treasurer} actor={session.actor ?? null}>
      {children}
    </AppShell>
  );
}