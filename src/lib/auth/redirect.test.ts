import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps a same-site deep link", () => {
    expect(safeNextPath("/notifications")).toBe("/notifications");
    expect(safeNextPath("/admin/members?status=pending")).toBe("/admin/members?status=pending");
    expect(safeNextPath("/secretary/day/2026-01-04/session/abc")).toBe(
      "/secretary/day/2026-01-04/session/abc",
    );
  });

  it("refuses anything that could leave the site", () => {
    // The value comes from a query string, so these are attacker-supplied.
    expect(safeNextPath("//evil.example")).toBe("");
    expect(safeNextPath("/\\evil.example")).toBe("");
    expect(safeNextPath("https://evil.example")).toBe("");
    expect(safeNextPath("javascript:alert(1)")).toBe("");
    expect(safeNextPath("evil.example/admin")).toBe("");
  });

  it("refuses the sign-in pages, which would loop", () => {
    expect(safeNextPath("/login")).toBe("");
    expect(safeNextPath("/login?next=/admin")).toBe("");
    expect(safeNextPath("/register")).toBe("");
    expect(safeNextPath("/register/status")).toBe("/register/status");
  });

  it("uses the fallback when there is nothing usable", () => {
    expect(safeNextPath(undefined)).toBe("");
    expect(safeNextPath(null)).toBe("");
    expect(safeNextPath("")).toBe("");
    expect(safeNextPath(undefined, "/admin")).toBe("/admin");
    expect(safeNextPath("//evil.example", "/admin")).toBe("/admin");
  });

  it("reads the first value when the query repeats the key", () => {
    expect(safeNextPath(["/notifications", "//evil.example"])).toBe("/notifications");
  });
});