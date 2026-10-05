import { describe, expect, it } from "vitest";
import { ROLE_ORDER, ROLE_PATH, ROLE_REACH, ROLE_SECTIONS, canReach, isRole, type Role } from "./roles";

describe("canReach", () => {
  it("always lets a role into its own section", () => {
    for (const role of ROLE_ORDER) {
      expect(canReach(role, role), role).toBe(true);
    }
  });

  it("lets the admin and the super admin into every operational role", () => {
    const operational: Role[] = ["admin", "secretary", "member", "officer", "treasurer"];
    for (const section of operational) {
      expect(canReach("admin", section), `admin -> ${section}`).toBe(true);
      expect(canReach("super_admin", section), `super_admin -> ${section}`).toBe(true);
    }
  });

  it("keeps the super admin namespace closed to the admin", () => {
    // The report-approval gate lives here. If admin could open it, the gate would be a suggestion.
    expect(canReach("super_admin", "super_admin")).toBe(true);
    expect(canReach("admin", "super_admin")).toBe(false);
  });

  it("keeps the four single-section roles out of every other role", () => {
    const narrow: Role[] = ["secretary", "member", "officer", "treasurer"];
    const others = ROLE_ORDER.filter((r) => !narrow.includes(r));
    for (const role of narrow) {
      for (const section of others) {
        expect(canReach(role, section), `${role} -> ${section}`).toBe(false);
      }
    }
  });

  it("is not symmetric, and that asymmetry is the point", () => {
    expect(canReach("admin", "member")).toBe(true);
    expect(canReach("member", "admin")).toBe(false);
  });

  it("agrees with ROLE_PATH about where a section lives", () => {
    for (const { prefix, role } of ROLE_SECTIONS) {
      expect(prefix, role).toBe(ROLE_PATH[role]);
    }
  });

  it("covers every role with a section and lists no role twice", () => {
    expect(ROLE_SECTIONS.map((s) => s.role).sort()).toEqual([...ROLE_ORDER].sort());
    for (const { role } of ROLE_SECTIONS) {
      expect(new Set(ROLE_REACH[role]).size, role).toBe(ROLE_REACH[role].length);
    }
  });
});

describe("isRole", () => {
  it("accepts the six roles and nothing else", () => {
    for (const role of ROLE_ORDER) expect(isRole(role)).toBe(true);
    expect(isRole("Super_Admin")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole("owner")).toBe(false);
  });
});
