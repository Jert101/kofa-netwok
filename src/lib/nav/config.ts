import { ROLE_REACH, type Role } from "@/lib/auth/roles";
import {
  CalendarDays,
  FileText,
  Home,
  Inbox,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  ScrollText,
  Settings,
  UserCheck,
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
  | "scrollText"
  | "templates"
  | "assign";

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
  templates: LayoutTemplate,
  assign: UserCheck,
};

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  /** Section homes (e.g. the role root) must only light up on themselves. */
  exact?: boolean;
  /** Extra paths that should also light up this item. */
  also?: readonly string[];
  /**
   * Asks the shell to hang an unread count off this item. COM-2 said the badge existed and it did
   * not; the gap was that nothing in the nav said where a count belonged, so every caller had to
   * special-case the inbox path. Naming it here is what makes the badge a property of the link
   * rather than a hard-coded href check.
   */
  badgeKey?: "notifications";
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
    { href: "/admin/appeals", label: "Appeals", icon: "scrollText" },
    { href: "/admin/reports", label: "Reports", icon: "fileText" },
    { href: "/admin/inbox", label: "Inbox", icon: "inbox", badgeKey: "notifications" },
    { href: "/admin/audit", label: "Audit", icon: "scrollText", also: ["/admin/audit"] },
    { href: "/admin/settings", label: "Settings", icon: "settings", also: ["/admin/security", "/admin/settings/system", "/admin/settings/backup"] },
  ],
  secretary: [
    { href: "/secretary", label: "Calendar", icon: "calendar", exact: true, also: ["/secretary/day", "/secretary/session"] },
    { href: "/secretary/appeals", label: "Appeals", icon: "scrollText" },
    { href: "/secretary/inbox", label: "Inbox", icon: "inbox", badgeKey: "notifications" },
    { href: "/secretary/payments", label: "Payments", icon: "wallet" },
    { href: "/secretary/reports", label: "Reports", icon: "fileText" },
  ],
  member: [
    { href: "/member", label: "Home", icon: "home", exact: true, also: ["/member/day"] },
    // COM-1: the feed is a page, not a corner of the dashboard, because a notification from the
    // catalog links straight to it and a link that lands on a page nobody can navigate back from is
    // a dead end with extra steps.
    { href: "/member/announcements", label: "Announcements", icon: "megaphone" },
    { href: "/member/payments", label: "Payments", icon: "wallet" },
  ],
  officer: [
    { href: "/officer", label: "Calendar", icon: "calendar", exact: true, also: ["/officer/day"] },
    { href: "/officer/inbox", label: "Announcements", icon: "megaphone" },
    { href: "/officer/templates", label: "Templates", icon: "templates" },
    { href: "/officer/assign", label: "Assign", icon: "assign" },
    { href: "/officer/payments", label: "Payments", icon: "wallet" },
  ],
  treasurer: [
    { href: "/treasurer", label: "Home", icon: "home", exact: true },
    {
      href: "/treasurer/payment-structures",
      label: "Structures",
      icon: "layers",
    },
    // PAY-5's build task 9 added a dedicated overdue page, so it needs its own nav item rather than
    // hiding behind the payments list.
    { href: "/treasurer/overdue", label: "Overdue", icon: "scrollText" },
    { href: "/treasurer/payments", label: "Payments", icon: "wallet", also: ["/treasurer/payments/csv"] },
  ],
  super_admin: [
    { href: "/super-admin", label: "Dashboard", icon: "dashboard", exact: true },
    { href: "/super-admin/reports", label: "Reports", icon: "fileText" },
    // The super admin was a recipient of notifications since before this module and had nowhere to
    // read them, which is the exact gap P2 describes.
    { href: "/super-admin/inbox", label: "Inbox", icon: "inbox", badgeKey: "notifications" },
  ],
};

/** One section of the sidebar: the pages of a single role, under that role's name. */
export type NavGroup = {
  role: Role;
  label: string;
  items: readonly NavItem[];
};

/**
 * `NAV_BY_ROLE` is one role's menu; this is a role's whole sidebar.
 *
 * A four-role sidebar is a flat list of "Menu" and reads fine. A sidebar carrying every page of six
 * roles is the same list twice over -- "Payments" four times, "Reports" three times -- so the items
 * are grouped by the section they belong to and each group is headed by the role's name.
 *
 * The groups come from `ROLE_REACH`, the same table the middleware and the API guard ask, so the
 * sidebar cannot offer a link that a guard would then refuse. A role that reaches only itself still
 * gets exactly one group, and the sidebar labels that one "Menu" so the four ordinary roles keep the
 * menu they have always had.
 */
function groupsFor(role: Role): readonly NavGroup[] {
  return ROLE_REACH[role].map((section) => ({
    role: section,
    label: ROLE_LABEL[section],
    items: NAV_BY_ROLE[section],
  }));
}

export const NAV_GROUPS_BY_ROLE: Record<Role, readonly NavGroup[]> = {
  admin: groupsFor("admin"),
  secretary: groupsFor("secretary"),
  member: groupsFor("member"),
  officer: groupsFor("officer"),
  treasurer: groupsFor("treasurer"),
  super_admin: groupsFor("super_admin"),
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
