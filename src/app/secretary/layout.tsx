import { AppShell } from "@/components/layout/AppShell";
import { NAV_BY_ROLE } from "@/lib/nav/config";
import { requireValidSession } from "@/lib/auth/require-valid-session";

export default async function SecretaryLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession("secretary");
  return (
    <AppShell role="secretary" links={NAV_BY_ROLE.secretary} actor={session.actor ?? null}>
      {children}
    </AppShell>
  );
}