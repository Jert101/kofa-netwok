import { describe, expect, it } from "vitest";
import { isActive, NAV_BY_ROLE, NAV_GROUPS_BY_ROLE, ROLE_LABEL, type NavItem } from "./config";
import { ROLE_ORDER, ROLE_REACH, canReach } from "@/lib/auth/roles";

const find = (role: keyof typeof NAV_BY_ROLE, href: string): NavItem => {
  const item = NAV_BY_ROLE[role].find((i) => i.href === href);
  if (!item) throw new Error(`missing nav item ${role}${href}`);
  return item;
};

describe("isActive", () => {
  it("matches the item's own path exactly", () => {
    expect(isActive("/admin", find("admin", "/admin"))).toBe(true);
    expect(isActive("/admin/members", find("admin", "/admin/members"))).toBe(true);
  });

  it("does not light the home item for a sibling section", () => {
    expect(isActive("/admin/inbox", find("admin", "/admin"))).toBe(false);
    expect(isActive("/admin/members", find("admin", "/admin"))).toBe(false);
    expect(isActive("/admin/payments", find("admin", "/admin"))).toBe(false);
  });

  it("lights only the section actually being viewed", () => {
    expect(isActive("/admin/inbox", find("admin", "/admin/inbox"))).toBe(true);
    expect(isActive("/admin/inbox", find("admin", "/admin/reports"))).toBe(false);
    expect(isActive("/admin/inbox", find("admin", "/admin/members"))).toBe(false);
  });

  it("lights a non-exact section for its child routes", () => {
    expect(isActive("/super-admin/reports/abc-123", find("super_admin", "/super-admin/reports"))).toBe(true);
  });

  it("keeps masses lit on admin day and session pages", () => {
    const masses = find("admin", "/admin/masses");
    expect(isActive("/admin/masses", masses)).toBe(true);
    expect(isActive("/admin/day/2026-01-04", masses)).toBe(true);
    expect(isActive("/admin/day/2026-01-04/session/7", masses)).toBe(true);
    expect(isActive("/admin/day", masses)).toBe(true);
    expect(isActive("/admin/settings", masses)).toBe(false);
  });

  it("keeps the calendar lit on secretary day and session pages", () => {
    const calendar = find("secretary", "/secretary");
    expect(isActive("/secretary", calendar)).toBe(true);
    expect(isActive("/secretary/day/2026-01-04", calendar)).toBe(true);
    expect(isActive("/secretary/day/2026-01-04/add", calendar)).toBe(true);
    expect(isActive("/secretary/session/12", calendar)).toBe(true);
    expect(isActive("/secretary/inbox", calendar)).toBe(false);
    expect(isActive("/secretary/payments", calendar)).toBe(false);
    expect(isActive("/secretary/reports", calendar)).toBe(false);
  });

  it("keeps the officer calendar lit on plan pages but not on posts", () => {
    const calendar = find("officer", "/officer");
    expect(isActive("/officer/day/2026-01-04", calendar)).toBe(true);
    expect(isActive("/officer/day/2026-01-04/plan/3", calendar)).toBe(true);
    expect(isActive("/officer/inbox", calendar)).toBe(false);
    expect(isActive("/officer/inbox", find("officer", "/officer/inbox"))).toBe(true);
  });

  it("keeps member home lit on day pages but not on payments", () => {
    const home = find("member", "/member");
    expect(isActive("/member", home)).toBe(true);
    expect(isActive("/member/day/2026-01-04", home)).toBe(true);
    expect(isActive("/member/day/2026-01-04/session/9", home)).toBe(true);
    expect(isActive("/member/payments", home)).toBe(false);
    expect(isActive("/member/payments", find("member", "/member/payments"))).toBe(true);
  });

  it("does not match a different role with the same suffix", () => {
    expect(isActive("/secretary/inbox", find("admin", "/admin/inbox"))).toBe(false);
    expect(isActive("/member", find("admin", "/admin"))).toBe(false);
  });

  it("never prefix-matches across the slash boundary", () => {
    const item: NavItem = { href: "/admin", label: "Home", icon: "home" };
    expect(isActive("/admin-tools", item)).toBe(false);
  });

  it("matches root only for the root path", () => {
    const root: NavItem = { href: "/", label: "Root", icon: "home" };
    expect(isActive("/", root)).toBe(true);
    expect(isActive("/member", root)).toBe(false);
  });

  it("gives every role at least one item and no duplicate hrefs", () => {
    for (const [role, items] of Object.entries(NAV_BY_ROLE)) {
      expect(items.length, role).toBeGreaterThan(0);
      expect(new Set(items.map((i) => i.href)).size, role).toBe(items.length);
    }
  });
});

describe("NAV_GROUPS_BY_ROLE", () => {
  const hrefsOf = (role: keyof typeof NAV_GROUPS_BY_ROLE) =>
    NAV_GROUPS_BY_ROLE[role].flatMap((g) => g.items.map((i) => i.href));

  it("gives every role one group per section it can reach", () => {
    for (const role of ROLE_ORDER) {
      expect(NAV_GROUPS_BY_ROLE[role].map((g) => g.role), role).toEqual(ROLE_REACH[role]);
    }
  });

  it("gives the admin and the super admin every role's pages they may reach", () => {
    for (const role of ["admin", "super_admin"] as const) {
      expect(hrefsOf(role).sort(), role).toEqual(
        ROLE_REACH[role]
          .flatMap((r) => NAV_BY_ROLE[r].map((i) => i.href))
          .sort(),
      );
      expect(ROLE_REACH[role].length, role).toBeGreaterThan(1);
    }
  });

  it("leaves the four single-section roles exactly the menu they had", () => {
    for (const role of ["secretary", "member", "officer", "treasurer"] as const) {
      expect(NAV_GROUPS_BY_ROLE[role], role).toHaveLength(1);
      expect(hrefsOf(role), role).toEqual(NAV_BY_ROLE[role].map((i) => i.href));
    }
  });

  it("keeps admin's own section first and leaves out super-admin", () => {
    expect(NAV_GROUPS_BY_ROLE.admin[0].role).toBe("admin");
    expect(NAV_GROUPS_BY_ROLE.admin.map((g) => g.role)).not.toContain("super_admin");
    expect(NAV_GROUPS_BY_ROLE.super_admin.map((g) => g.role)).toContain("super_admin");
  });

  it("never offers a link the guards would refuse", () => {
    // The regression this guards: a sidebar that lists a page and then bounces off it. Every href has
    // to sit inside a section the session can reach, and role prefixes are mutually exclusive.
    for (const role of ROLE_ORDER) {
      for (const group of NAV_GROUPS_BY_ROLE[role]) {
        expect(canReach(role, group.role), `${role} -> ${group.role}`).toBe(true);
        for (const item of group.items) {
          expect(item.href, `${role} -> ${item.href}`).toMatch(
            new RegExp(`^${group.role === "super_admin" ? "/super-admin" : `/${group.role}`}(/|$)`),
          );
        }
      }
    }
  });

  it("has no duplicate href anywhere in one sidebar", () => {
    for (const role of ROLE_ORDER) {
      const hrefs = hrefsOf(role);
      expect(new Set(hrefs).size, role).toBe(hrefs.length);
    }
  });

  it("labels each group with its role's name", () => {
    for (const role of ROLE_ORDER) {
      for (const group of NAV_GROUPS_BY_ROLE[role]) {
        expect(group.label, group.role).toBe(ROLE_LABEL[group.role]);
        expect(group.items.length, group.role).toBeGreaterThan(0);
      }
    }
  });
});

