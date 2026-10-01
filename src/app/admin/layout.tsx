import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/AppShell";
import { DefaultPinBanner } from "@/components/admin/DefaultPinBanner";
import { NAV_BY_ROLE } from "@/lib/nav/config";
import { requireValidSession } from "@/lib/auth/require-valid-session";
import { DEFAULT_PIN_ROLES_COOKIE } from "@/lib/auth/constants";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession("admin");
  const jar = await cookies();
  return (
    <AppShell role="admin" links={NAV_BY_ROLE.admin} actor={session.actor ?? null}>
      <DefaultPinBanner roles={jar.get(DEFAULT_PIN_ROLES_COOKIE)?.value} />
      {children}
    </AppShell>
  );
}
