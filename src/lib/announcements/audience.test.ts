import { describe, expect, it } from "vitest";
import {
  audienceOf,
  canModify,
  describeAudience,
  expiryFor,
  isExpired,
  isForViewer,
  MAX_PINNED,
  normalizeAudience,
  sortAnnouncements,
  wasEdited,
  type AnnouncementRow,
} from "./audience";

const NOW = new Date("2026-10-02T12:00:00.000Z");

function row(over: Partial<AnnouncementRow> & { id: string }): AnnouncementRow {
  return {
    created_at: "2026-10-01T12:00:00.000Z",
    created_by: "secretary",
    audience_roles: null,
    audience_batches: null,
    delete_at: null,
    pinned: false,
    ...over,
  };
}

describe("normalizeAudience", () => {
  it("treats null, empty and absent as everyone", () => {
    expect(normalizeAudience({ roles: null, batches: null })).toEqual({ roles: [], batches: [] });
    expect(normalizeAudience({})).toEqual({ roles: [], batches: [] });
    expect(normalizeAudience({ roles: [], batches: [] })).toEqual({ roles: [], batches: [] });
  });

  it("drops unknown roles, trims case and de-duplicates", () => {
    const a = normalizeAudience({
      roles: [" Secretary ", "secretary", "wizard", "", "MEMBER"],
      batches: [" 2024 ", "2024", "2025"],
    });
    expect(a.roles).toEqual(["secretary", "member"]);
    expect(a.batches).toEqual(["2024", "2025"]);
  });
});

describe("isForViewer", () => {
  const secretaryOnly = normalizeAudience({ roles: ["secretary"] });
  const batchOnly = normalizeAudience({ batches: ["2024"] });
  const everyone = normalizeAudience({});

  it("shows a role post to that role and hides it from others", () => {
    expect(isForViewer(secretaryOnly, { role: "secretary", batch: "2019" })).toBe(true);
    expect(isForViewer(secretaryOnly, { role: "member", batch: "2024" })).toBe(false);
  });

  it("unions roles and batches rather than intersecting them", () => {
    const both = normalizeAudience({ roles: ["secretary"], batches: ["2024"] });
    // Role matches, batch does not.
    expect(isForViewer(both, { role: "secretary", batch: "2019" })).toBe(true);
    // Batch matches, role does not.
    expect(isForViewer(both, { role: "member", batch: "2024" })).toBe(true);
    // Neither matches.
    expect(isForViewer(both, { role: "member", batch: "2019" })).toBe(false);
  });

  it("shows a batch post only to someone with that batch", () => {
    expect(isForViewer(batchOnly, { role: "member", batch: "2024" })).toBe(true);
    expect(isForViewer(batchOnly, { role: "member", batch: null })).toBe(false);
  });

  it("shows an empty audience to everyone", () => {
    expect(isForViewer(everyone, { role: "member", batch: null })).toBe(true);
    expect(isForViewer(everyone, { role: "super_admin", batch: "2024" })).toBe(true);
  });
});

describe("audienceOf", () => {
  it("reads the stored columns and nothing else", () => {
    expect(audienceOf(row({ id: "a", audience_roles: ["officer"], audience_batches: ["2023"] }))).toEqual({
      roles: ["officer"],
      batches: ["2023"],
    });
  });
});

describe("expiry", () => {
  it("reads a past delete_at as expired and a future one as live", () => {
    expect(isExpired(row({ id: "a", delete_at: "2026-10-01T00:00:00.000Z" }), NOW)).toBe(true);
    expect(isExpired(row({ id: "a", delete_at: "2026-10-03T00:00:00.000Z" }), NOW)).toBe(false);
    expect(isExpired(row({ id: "a", delete_at: null }), NOW)).toBe(false);
  });

  it("treats the exact expiry instant as gone, not as live", () => {
    expect(isExpired(row({ id: "a", delete_at: NOW.toISOString() }), NOW)).toBe(true);
  });

  it("turns the presets into the right delete_at", () => {
    const week = expiryFor("week", NOW);
    const month = expiryFor("month", NOW);
    expect(Date.parse(week!) - NOW.getTime()).toBe(7 * 86_400_000);
    expect(Date.parse(month!) - NOW.getTime()).toBe(30 * 86_400_000);
    expect(expiryFor("never", NOW)).toBeNull();
    expect(expiryFor("custom", NOW, "2026-12-25T00:00:00.000Z")).toBe("2026-12-25T00:00:00.000Z");
    // A custom preset with no date chosen is not an expiry, it is an unanswered question.
    expect(expiryFor("custom", NOW, null)).toBeNull();
  });
});

describe("sortAnnouncements", () => {
  it("puts pinned first, then newest", () => {
    const out = sortAnnouncements(
      [
        row({ id: "old", created_at: "2026-09-01T00:00:00.000Z" }),
        row({ id: "new", created_at: "2026-10-01T00:00:00.000Z" }),
        row({ id: "pinned", created_at: "2026-08-01T00:00:00.000Z", pinned: true }),
      ],
      NOW,
    );
    expect(out.map((r) => r.id)).toEqual(["pinned", "new", "old"]);
  });

  it("hides expired posts even when they are pinned", () => {
    const out = sortAnnouncements(
      [
        row({ id: "live", created_at: "2026-10-01T00:00:00.000Z" }),
        row({ id: "gone", pinned: true, delete_at: "2026-09-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(out.map((r) => r.id)).toEqual(["live"]);
  });

  it(`caps the pinned block at ${MAX_PINNED} by demoting the rest, never by hiding them`, () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `p${i}`, pinned: true, created_at: `2026-09-0${i + 1}T00:00:00.000Z` }),
    );
    const out = sortAnnouncements(rows, NOW);
    expect(out).toHaveLength(5);
    expect(out.filter((r) => r.pinned).map((r) => r.id)).toEqual(["p4", "p3", "p2"]);
    // The demoted two keep their content and their place in the ordinary flow.
    expect(out.map((r) => r.id)).toEqual(["p4", "p3", "p2", "p1", "p0"]);
  });

  it("is stable for identical timestamps rather than depending on input order", () => {
    const same = "2026-10-01T00:00:00.000Z";
    const a = sortAnnouncements(
      [row({ id: "first", created_at: same }), row({ id: "second", created_at: same })],
      NOW,
    );
    expect(a.map((r) => r.id)).toEqual(["first", "second"]);
  });
});

describe("canModify", () => {
  it("lets the creating role edit", () => {
    expect(canModify(row({ id: "a", created_by: "officer" }), "officer")).toBe(true);
  });

  it("lets an admin edit anyone's", () => {
    expect(canModify(row({ id: "a", created_by: "officer" }), "admin")).toBe(true);
  });

  it("stops another role from editing", () => {
    expect(canModify(row({ id: "a", created_by: "officer" }), "secretary")).toBe(false);
    expect(canModify(row({ id: "a", created_by: "officer" }), "member")).toBe(false);
  });

  it("never lets anyone edit a system post, admin included", () => {
    expect(canModify(row({ id: "a", created_by: "system" }), "admin")).toBe(false);
    expect(canModify(row({ id: "a", created_by: "system" }), "secretary")).toBe(false);
  });
});

describe("wasEdited", () => {
  it("is false until an edit stamps updated_at", () => {
    expect(wasEdited(row({ id: "a" }))).toBe(false);
    expect(wasEdited(row({ id: "a", updated_at: null }))).toBe(false);
    expect(wasEdited(row({ id: "a", updated_at: "2026-10-02T09:00:00.000Z" }))).toBe(true);
  });
});

describe("describeAudience", () => {
  it("says Everyone for the empty audience", () => {
    expect(describeAudience({ roles: [], batches: [] })).toBe("Everyone");
  });

  it("pluralises roles as English would, not by appending s", () => {
    expect(describeAudience({ roles: ["secretary"], batches: [] })).toBe("Secretaries");
    expect(describeAudience({ roles: ["officer", "treasurer"], batches: [] })).toBe(
      "Officers and Treasurers",
    );
  });

  it("names batches and joins both halves", () => {
    expect(describeAudience({ roles: ["officer"], batches: ["2024"] })).toBe("Officers + batch 2024");
    expect(describeAudience({ roles: [], batches: ["2023", "2024"] })).toBe("batches 2023 and 2024");
  });

  it("falls back to the raw role for one it has no label for", () => {
    expect(describeAudience({ roles: ["super_admin" as never], batches: [] })).toBe("super_admin");
  });
});
