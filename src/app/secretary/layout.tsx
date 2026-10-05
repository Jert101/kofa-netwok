import { AppShell } from "@/components/layout/AppShell";
import { NAV_GROUPS_BY_ROLE } from "@/lib/nav/config";
import { requireValidSession } from "@/lib/auth/require-valid-session";

export default async function SecretaryLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession("secretary");
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
