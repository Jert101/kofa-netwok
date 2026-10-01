import { describe, expect, it } from "vitest";
import {
  applySearch,
  birthMonth,
  memberQuerySchema,
  parseMemberQuery,
} from "@/features/members/member-query";

function member(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "id",
    full_name: "Jerson L. Catadman",
    date_of_birth: "1990-05-04",
    gender: "male",
    contact_number: "09171234567",
    batch: "2025",
    is_active: true,
    deactivated_at: null,
    deactivation_reason: null,
    created_at: "2025-01-01T00:00:00Z",
    ...over,
  };
}

describe("birthMonth", () => {
  it("reads the month out of a stored date", () => {
    expect(birthMonth("1990-05-04")).toBe("05");
    expect(birthMonth("1990-12-31")).toBe("12");
  });

  it("returns null when there is no usable date", () => {
    expect(birthMonth(null)).toBeNull();
    expect(birthMonth("")).toBeNull();
    expect(birthMonth("1990")).toBeNull();
    expect(birthMonth("1990-13-01")).toBeNull();
    expect(birthMonth("1990-00-01")).toBeNull();
  });
});

describe("memberQuerySchema", () => {
  it("defaults to active members sorted by name, 25 to a page", () => {
    const q = memberQuerySchema.parse({});
    expect(q.status).toBe("active");
    expect(q.sort).toBe("name");
    expect(q.dir).toBe("asc");
    expect(q.page).toBe(1);
    expect(q.page_size).toBe(25);
  });

  it("rejects a month outside 1 to 12 instead of silently matching nothing", () => {
    expect(memberQuerySchema.safeParse({ birth_month: "13" }).success).toBe(false);
    expect(memberQuerySchema.safeParse({ birth_month: "0" }).success).toBe(false);
    expect(memberQuerySchema.safeParse({ birth_month: "5" }).success).toBe(true);
  });

  it("caps the page size at 100 (MEM edge case: very large directories)", () => {
    expect(memberQuerySchema.safeParse({ page_size: 101 }).success).toBe(false);
    expect(memberQuerySchema.parse({ page_size: 100 }).page_size).toBe(100);
  });

  it("rejects an unknown sort column", () => {
    expect(memberQuerySchema.safeParse({ sort: "; drop table members" }).success).toBe(false);
  });

  it("accepts the three sorts the spec lists", () => {
    for (const sort of ["name", "batch", "date_of_birth"]) {
      expect(memberQuerySchema.parse({ sort }).sort).toBe(sort);
    }
  });
});

describe("parseMemberQuery", () => {
  it("reads a full query from a URL", () => {
    const params = new URLSearchParams(
      "q=catadman&batch=2025&gender=male&status=inactive&birth_month=5&sort=batch&dir=desc&page=3&pageSize=50",
    );
    const q = parseMemberQuery(params);
    expect(q).toMatchObject({
      q: "catadman",
      batch: "2025",
      gender: "male",
      status: "inactive",
      birth_month: "5",
      sort: "batch",
      dir: "desc",
      page: 3,
      page_size: 50,
    });
  });

  it("treats an empty filter as not set rather than as a search for nothing", () => {
    const q = parseMemberQuery(new URLSearchParams("q=&batch=&gender=&birth_month="));
    expect(q.q).toBe("");
    expect(q.batch).toBe("");
    expect(q.gender).toBe("");
    expect(q.birth_month).toBe("");
  });

  it("accepts page_size as well as pageSize", () => {
    expect(parseMemberQuery(new URLSearchParams("page_size=10")).page_size).toBe(10);
    expect(parseMemberQuery(new URLSearchParams("pageSize=10")).page_size).toBe(10);
  });
});

describe("member row shape", () => {
  it("carries the deactivation fields the directory shows", () => {
    const row = member({ is_active: false, deactivated_at: "2026-01-02T00:00:00Z" });
    expect(row.is_active).toBe(false);
    expect(row.deactivated_at).toBe("2026-01-02T00:00:00Z");
  });
});

describe("applySearch", () => {
  const jerson = member({ id: "1", full_name: "Jerson L. Catadman" });
  const maria = member({
    id: "2",
    full_name: "Maria Santos",
    contact_number: "09181234567",
    batch: "2024",
  });
  const noContact = member({ id: "3", full_name: "Pedro Cruz", contact_number: null });
  const everyone = [jerson, maria, noContact];

  it("returns everyone when nothing was typed", () => {
    expect(applySearch(everyone, "")).toHaveLength(3);
    expect(applySearch(everyone, "   ")).toHaveLength(3);
  });

  it("finds one person by name", () => {
    expect(applySearch(everyone, "Catadman").map((r) => r.id)).toEqual(["1"]);
  });

  it("finds by any part of the name, case aside", () => {
    expect(applySearch(everyone, "jerson").map((r) => r.id)).toEqual(["1"]);
    expect(applySearch(everyone, "CATADMAN").map((r) => r.id)).toEqual(["1"]);
  });

  // The bug this guards: a name search used to match every member who had a
  // contact number, because stripping the digits off "jerson" leaves "" and every
  // string contains "". The list then looked like the search had been ignored.
  it("does not match everyone just because the search has no digits in it", () => {
    expect(applySearch(everyone, "jerson").map((r) => r.id)).toEqual(["1"]);
  });

  it("finds by the first part of a name when the rest is missing", () => {
    expect(applySearch(everyone, "santos").map((r) => r.id)).toEqual(["2"]);
  });

  it("finds by contact number, ignoring how it was punctuated", () => {
    expect(applySearch(everyone, "0918").map((r) => r.id)).toEqual(["2"]);
    expect(applySearch(everyone, "09181234567").map((r) => r.id)).toEqual(["2"]);
  });

  it("finds by batch", () => {
    expect(applySearch(everyone, "2024").map((r) => r.id)).toEqual(["2"]);
  });

  it("returns nothing when the name is not on the list", () => {
    expect(applySearch(everyone, "Dela Cruz")).toEqual([]);
  });

  it("does not match a member with no contact number on a digit search", () => {
    expect(applySearch([noContact], "0918")).toEqual([]);
  });
});
