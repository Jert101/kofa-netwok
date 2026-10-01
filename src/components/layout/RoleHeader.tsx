"use client";

import Image from "next/image";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ROLE_LABEL } from "@/lib/nav/config";
import type { Role } from "@/lib/auth/roles";

export function RoleHeader({ role }: { role: Role }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2 md:h-16 md:px-4">
      <SidebarTrigger
        className="-ml-1"
        aria-label="Open menu"
      />
      <Image
        src="/logo.png"
        alt="Knights of the Altar logo"
        width={26}
        height={26}
        className="shrink-0 rounded-full md:hidden"
      />
      <span className="truncate text-sm font-semibold text-[var(--accent)] md:text-base">
        {ROLE_LABEL[role]}
      </span>
    </header>
  );
}
