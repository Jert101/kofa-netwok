"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { BellRing } from "lucide-react";
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
import { ThemeSwitch } from "@/components/layout/ThemeSwitch";
import { PwaHub } from "@/components/PwaHub";
import { ActorPicker, type ActorOption } from "@/components/auth/ActorPicker";
import { NAV_ICONS, ROLE_LABEL, isActive, type NavGroup } from "@/lib/nav/config";
import type { Role } from "@/lib/auth/roles";

/**
 * COM-2: the unread count on the nav item that asked for one.
 *
 * The number, not a dot. A dot says "something" and cannot be acted on; the badge is also capped at
 * 99 because a four digit pill in a collapsed sidebar stops being a badge and starts being a layout
 * problem, and nobody needs to know that there are 4,203 unread.
 */
export function AppSidebar({
  role,
  groups,
  actor = null,
}: {
  role: Role;
  groups: readonly NavGroup[];
  actor?: ActorOption | null;
}) {
  const pathname = usePathname();

  // One section keeps the label it has always had. Two or more need the role's name, or three
  // different "Payments" in a column with nothing to tell them apart.
  const byRole = groups.length > 1;

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
            <span className="truncate text-sm font-semibold text-[var(--brand)]">
              KofA Attendance
            </span>
            <span className="truncate text-xs text-[var(--text-muted)]">
              {ROLE_LABEL[role]}
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.role}>
            <SidebarGroupLabel>{byRole ? group.label : "Menu"}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  const active = isActive(pathname, item);
                  const own = group.role === role;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={own ? item.label : `${group.label} · ${item.label}`}
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
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/*
            COM-4: device notification settings, next to the identity picker and the app hub rather
            than buried in a nav group. It is the same for every role, so it is one link and not six.
          */}
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Notification settings" className="min-h-11">
              <Link href="/notifications">
                <BellRing aria-hidden />
                <span>Notifications</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ActorPicker actor={actor} />
          </SidebarMenuItem>
          {/*
            FW-7: the theme switch sits in the account menu, which module 01 §4.1 specifies as "the role,
            theme switch, and Log out". It is a footer entry rather than something buried in Settings
            because a person toggling it at 7am in a bright church is doing it once, not configuring it.
          */}
          <SidebarMenuItem>
            <ThemeSwitch />
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