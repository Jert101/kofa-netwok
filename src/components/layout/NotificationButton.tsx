"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { useUnreadCount } from "@/lib/comms/use-unread-count";
import type { Role } from "@/lib/auth/roles";

/** Where the header bell opens for each role. */
function notificationsPath(role: Role): string {
  switch (role) {
    case "admin":
      return "/admin/inbox";
    case "secretary":
      return "/secretary/inbox";
    case "super_admin":
      return "/super-admin/inbox";
    // Member, officer and treasurer do not have a dedicated notification inbox route; their
    // notifications land on the shared notifications screen.
    default:
      return "/notifications";
  }
}

/**
 * The one notifications entry for the whole app, now in the header.
 *
 * It used to be split: an unread pill on the sidebar's inbox row (badgeKey) and a separate
 * Notifications settings link in the sidebar footer. The count refreshes on a short interval and on
 * the window coming back to front, so it reads as live rather than stuck on the number it was when
 * the page loaded. The sidebar keeps no count now.
 */
export function NotificationButton({ role }: { role: Role }) {
  const unread = useUnreadCount();
  const hasUnread = unread !== null && unread > 0;

  return (
    <Link
      href={notificationsPath(role)}
      aria-label={hasUnread ? `${unread} unread notifications` : "Notifications"}
      className="relative inline-flex size-10 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
    >
      <Bell aria-hidden className="size-5" />
      {hasUnread ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}