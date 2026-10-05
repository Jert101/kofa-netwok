import { describe, expect, it } from "vitest";
import { roleAllowed } from "./guard";

/**
 * The guard's decision is split out from token verification so it can be tested directly. Two rules
 * matter and they pull in opposite directions:
 *
 *  - by default a session acts as any role it reaches, so an overseer's sidebar link lands on a working
 *    page instead of a 401;
 *  - `selfOnly` opts a route out of that, for actions a spec reserves to one role (voiding a payment).
 */
describe("roleAllowed", () => {
  it("admits the role that owns the route", () => {
    expect(roleAllowed("treasurer", ["treasurer"])).toBe(true);
    expect(roleAllowed("secretary", ["secretary"])).toBe(true);
    expect(roleAllowed("admin", ["admin"])).toBe(true);
  });

  it("lets an overseer borrow a route declared for a role it reaches", () => {
    // The reason the reach table exists: /treasurer fetches /api/dashboard/treasurer, declared
    // ["treasurer"], so an admin opening that page must not get a 401.
    expect(roleAllowed("admin", ["treasurer"])).toBe(true);
    expect(roleAllowed("super_admin", ["treasurer"])).toBe(true);
    expect(roleAllowed("super_admin", ["admin"])).toBe(true);
  });

  it("does not let a borrowing session claim a role it cannot reach", () => {
    // admin reaching treasurer is one direction only.
    expect(roleAllowed("treasurer", ["admin"])).toBe(false);
    expect(roleAllowed("member", ["secretary"])).toBe(false);
    expect(roleAllowed("officer", ["member"])).toBe(false);
  });

  it("keeps the super admin namespace closed to admin", () => {
    // The report-approval gate is answerable only by the role that owns it.
    expect(roleAllowed("admin", ["super_admin"])).toBe(false);
    expect(roleAllowed("super_admin", ["super_admin"])).toBe(true);
  });

  it("is satisfied by any one role in a multi-role allowlist", () => {
    expect(roleAllowed("member", ["admin", "treasurer", "member", "officer", "secretary"])).toBe(true);
    expect(roleAllowed("secretary", ["admin", "treasurer", "member", "officer", "secretary"])).toBe(true);
    expect(roleAllowed("super_admin", ["member"])).toBe(true);
  });

  describe("selfOnly", () => {
    it("refuses a role that would otherwise be reached", () => {
      // Spec PAY-3: the admin can record a payment but may not void one.
      expect(roleAllowed("admin", ["treasurer"], true)).toBe(false);
      expect(roleAllowed("super_admin", ["treasurer"], true)).toBe(false);
    });

    it("still admits the owning role", () => {
      expect(roleAllowed("treasurer", ["treasurer"], true)).toBe(true);
      expect(roleAllowed("super_admin", ["super_admin"], true)).toBe(true);
    });

    it("matches the plain check for a single-role allowlist the session owns", () => {
      for (const role of ["admin", "secretary", "member", "officer", "treasurer", "super_admin"] as const) {
        expect(roleAllowed(role, [role], true)).toBe(roleAllowed(role, [role]));
      }
    });
  });
});