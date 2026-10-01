"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { PwaHub } from "@/components/PwaHub";
import { ActorPicker, type ActorOption } from "@/components/auth/ActorPicker";
import { NAV_ICONS, ROLE_LABEL, isActive, type NavItem } from "@/lib/nav/config";
import type { Role } from "@/lib/auth/roles";

export function AppSidebar({
  role,
  links,
  actor = null,
}: {
  role: Role;
  links: readonly NavItem[];
  actor?: ActorOption | null;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <Image
            src="/logo.png"
            alt="Knights of the Altar logo"
            width={30}
            height={30}
            className="shrink-0 rounded-full"
          />
          <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold text-[var(--accent)]">
              KofA Attendance
            </span>
            <span className="truncate text-xs text-[var(--muted)]">
              {ROLE_LABEL[role]}
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {links.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                const active = isActive(pathname, item);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className="min-h-11"
                    >
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon aria-hidden />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ActorPicker actor={actor} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <PwaHub />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <LogoutButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}