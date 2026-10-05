import { AppSidebar } from "@/components/layout/AppSidebar";
import { RoleHeader } from "@/components/layout/RoleHeader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { NavGroup } from "@/lib/nav/config";
import type { Role } from "@/lib/auth/roles";
import type { SessionActor } from "@/lib/auth/session";

/**
 * `role` is who is signed in, not which section is being viewed.
 *
 * An admin reading `/treasurer` still gets the Administrator header and the admin's full menu, because
 * that is the menu that can get them back out. A shell keyed to the section would strip the sidebar
 * down to four treasurer links the moment they left their own pages, which is the opposite of having
 * every page in it.
 */
export function AppShell({
  role,
  groups,
  actor = null,
  children,
}: {
  role: Role;
  groups: readonly NavGroup[];
  actor?: SessionActor | null;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar role={role} groups={groups} actor={actor} />
      <SidebarInset className="min-h-dvh bg-[var(--background)]">
        <RoleHeader role={role} />
        <div className="mx-auto w-full max-w-6xl px-3 py-4 md:px-4 md:py-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}