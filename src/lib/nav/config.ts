import type { Role } from "@/lib/auth/roles";
import {
  CalendarDays,
  FileText,
  Home,
  Inbox,
  Layers,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  Settings,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavIconName =
  | "home"
  | "dashboard"
  | "users"
  | "userPlus"
  | "wallet"
  | "calendar"
  | "fileText"
  | "inbox"
  | "settings"
  | "megaphone"
  | "layers"
  | "scrollText";

/** Resolved inside client components only. Server code imports the types with `import type`. */
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  home: Home,
  dashboard: LayoutDashboard,
  users: Users,
  userPlus: UserPlus,
  wallet: Wallet,
  calendar: CalendarDays,
  fileText: FileText,
  inbox: Inbox,
  settings: Settings,
  megaphone: Megaphone,
  layers: Layers,
  scrollText: ScrollText,
};

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  /** Section homes (e.g. the role root) must only light up on themselves. */
  exact?: boolean;
  /** Extra paths that should also light up this item. */
  also?: readonly string[];
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrator",
  secretary: "Secretary",
  member: "Member",
  officer: "Officer",
  treasurer: "Treasurer",
  super_admin: "Super Admin",
};

export const NAV_BY_ROLE: Record<Role, readonly NavItem[]> = {
  admin: [
    { href: "/admin", label: "Home", icon: "home", exact: true },
    { href: "/admin/members", label: "Members", icon: "users" },
    { href: "/admin/registrations", label: "Registrations", icon: "userPlus" },
    { href: "/admin/payments", label: "Payments", icon: "wallet" },
    { href: "/admin/masses", label: "Masses", icon: "calendar", also: ["/admin/day"] },
    { href: "/admin/reports", label: "Reports", icon: "fileText" },
    { href: "/admin/inbox", label: "Inbox", icon: "inbox" },
    { href: "/admin/audit", label: "Audit", icon: "scrollText", also: ["/admin/audit"] },
    { href: "/admin/settings", label: "Settings", icon: "settings", also: ["/admin/security"] },
  ],
  secretary: [
    { href: "/secretary", label: "Calendar", icon: "calendar", exact: true, also: ["/secretary/day", "/secretary/session"] },
    { href: "/secretary/inbox", label: "Inbox", icon: "inbox" },
    { href: "/secretary/payments", label: "Payments", icon: "wallet" },
    { href: "/secretary/reports", label: "Reports", icon: "fileText" },
  ],
  member: [
    { href: "/member", label: "Home", icon: "home", exact: true, also: ["/member/day"] },
    { href: "/member/payments", label: "Payments", icon: "wallet" },
  ],
  officer: [
    { href: "/officer", label: "Calendar", icon: "calendar", exact: true, also: ["/officer/day"] },
    { href: "/officer/inbox", label: "Posts", icon: "megaphone" },
    { href: "/officer/payments", label: "Payments", icon: "wallet" },
  ],
  treasurer: [
    { href: "/treasurer", label: "Home", icon: "home", exact: true },
    {
      href: "/treasurer/payment-structures",
      label: "Structures",
      icon: "layers",
    },
    { href: "/treasurer/payments", label: "Payments", icon: "wallet" },
  ],
  super_admin: [
    { href: "/super-admin", label: "Dashboard", icon: "dashboard", exact: true },
    { href: "/super-admin/reports", label: "Reports", icon: "fileText" },
  ],
};

/** Exact match on the item's own path; prefix match on child routes only for
 * non-exact items. `also` paths light the item up too. `/admin` never lights up
 * for `/admin/inbox` because Home is exact.
 */
export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") {
    return pathname === "/";
  }
  if (!item.exact && pathname.startsWith(`${item.href}/`)) {
    return true;
  }
  if (pathname === item.href) {
    return true;
  }
  return item.also?.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ?? false;
}
