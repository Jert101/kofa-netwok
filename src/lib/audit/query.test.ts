import { describe, expect, it } from "vitest";
import {
  AUDIT_EXPORT_LIMIT,
  AUDIT_PAGE_SIZE,
  auditSearchFilter,
  parseAuditQuery,
  sanitizeForOr,
} from "./query";

const params = (q: string) => new URLSearchParams(q);

describe("parseAuditQuery", () => {
  it("defaults to the first page with no filters", () => {
    expect(parseAuditQuery(params(""))).toEqual({
      from: null,
      to: null,
      role: null,
      action: null,
      q: null,
      page: 1,
    });
  });

  it("normalizes date filters to ISO", () => {
    const f = parseAuditQuery(params("from=2026-01-01&to=2026-02-01"));
    expect(f.from).toBe(new Date("2026-01-01").toISOString());
    expect(f.to).toBe(new Date("2026-02-01").toISOString());
  });

  it("drops an unparseable date instead of failing the request", () => {
    expect(parseAuditQuery(params("from=last-tuesday")).from).toBeNull();
  });

  it("accepts a known role and action", () => {
    const f = parseAuditQuery(params("role=secretary&action=pin_changed"));
    expect(f.role).toBe("secretary");
    expect(f.action).toBe("pin_changed");
  });

  it("rejects an unknown role so it cannot silently widen the result set", () => {
    expect(parseAuditQuery(params("role=superuser")).role).toBeNull();
  });

  it("rejects an action outside the vocabulary", () => {
    expect(parseAuditQuery(params("action=drop_table")).action).toBeNull();
  });

  it("trims the search term and treats blank as absent", () => {
    expect(parseAuditQuery(params("q=%20%20")).q).toBeNull();
    expect(parseAuditQuery(params("q=%20maria%20")).q).toBe("maria");
  });

  it("clamps the page number", () => {
    expect(parseAuditQuery(params("page=0")).page).toBe(1);
    expect(parseAuditQuery(params("page=-3")).page).toBe(1);
    expect(parseAuditQuery(params("page=abc")).page).toBe(1);
    expect(parseAuditQuery(params("page=4")).page).toBe(4);
  });
});

describe("sanitizeForOr", () => {
  it("strips PostgREST or-filter metacharacters", () => {
    expect(sanitizeForOr("a,b")).toBe("a b");
    expect(sanitizeForOr("or(1)")).toBe("or 1");
    expect(sanitizeForOr("100%")).toBe("100");
  });

  it("keeps ordinary names intact", () => {
    expect(sanitizeForOr("maria santos")).toBe("maria santos");
  });
});

describe("auditSearchFilter", () => {
  it("searches actor name and action together", () => {
    expect(auditSearchFilter("maria")).toBe("actor_name.ilike.%maria%,action.ilike.%maria%");
  });

  it("neutralizes a crafted filter injection", () => {
    // Without sanitizing, this closes the ilike group and appends its own predicate.
    const filter = auditSearchFilter("x%' OR actor_role.eq.admin--");
    expect(filter).toBe("actor_name.ilike.%x ' OR actor_role.eq.admin--%,action.ilike.%x ' OR actor_role.eq.admin--%");
    expect(filter).not.toContain("%,actor");
  });
});

describe("paging limits", () => {
  it("pages the viewer at 50 and caps exports at 5000", () => {
    expect(AUDIT_PAGE_SIZE).toBe(50);
    expect(AUDIT_EXPORT_LIMIT).toBe(5_000);
  });
});
