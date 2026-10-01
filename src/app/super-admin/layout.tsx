import { AppShell } from "@/components/layout/AppShell";
import { NAV_BY_ROLE } from "@/lib/nav/config";
import { requireValidSession } from "@/lib/auth/require-valid-session";

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession("super_admin");
  return (
    <AppShell role="super_admin" links={NAV_BY_ROLE.super_admin} actor={session.actor ?? null}>
      {children}
    </AppShell>
  );
}