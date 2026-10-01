import { AppSidebar } from "@/components/layout/AppSidebar";
import { RoleHeader } from "@/components/layout/RoleHeader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { NavItem } from "@/lib/nav/config";
import type { Role } from "@/lib/auth/roles";
import type { SessionActor } from "@/lib/auth/session";

export function AppShell({
  role,
  links,
  actor = null,
  children,
}: {
  role: Role;
  links: readonly NavItem[];
  actor?: SessionActor | null;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar role={role} links={links} actor={actor} />
      <SidebarInset className="min-h-dvh bg-[var(--background)]">
        <RoleHeader role={role} />
        <div className="mx-auto w-full max-w-6xl px-3 py-4 md:px-4 md:py-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}