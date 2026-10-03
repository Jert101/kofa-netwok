import { describe, expect, it } from "vitest";
import { decideAppealEligibility, explainBlocked } from "./eligibility";

describe("decideAppealEligibility", () => {
  it("allows a member who is missing from the attendance", () => {
    const r = decideAppealEligibility({
      requested: ["m1"],
      onRoster: ["m2"],
      pending: ["m3"],
    });

    expect(r.eligible).toEqual(["m1"]);
    expect(r.blocked).toEqual([]);
  });

  it("refuses someone already on the attendance list", () => {
    const r = decideAppealEligibility({ requested: ["m1"], onRoster: ["m1"] });

    expect(r.eligible).toEqual([]);
    expect(r.blocked).toEqual([{ member_id: "m1", reason: "on_roster" }]);
  });

  it("refuses a second appeal while the first is pending", () => {
    const r = decideAppealEligibility({ requested: ["m1"], pending: ["m1"] });

    expect(r.blocked).toEqual([{ member_id: "m1", reason: "already_pending" }]);
  });

  it("allows a member whose previous appeal was rejected", () => {
    // A rejected appeal is a decision, not a lock. If this were refused, the reviewer who
    // rejected it would have the final say permanently, which is not what review means.
    const r = decideAppealEligibility({ requested: ["m1"], onRoster: [], pending: [] });

    expect(r.eligible).toEqual(["m1"]);
    expect(r.blocked).toEqual([]);
  });

  it("refuses an inactive member", () => {
    const r = decideAppealEligibility({ requested: ["m1"], inactive: ["m1"] });

    expect(r.blocked).toEqual([{ member_id: "m1", reason: "inactive" }]);
  });

  it("de-duplicates a member selected twice", () => {
    const r = decideAppealEligibility({ requested: ["m1", "m1", "m2"], onRoster: ["m1"] });

    expect(r.blocked).toEqual([{ member_id: "m1", reason: "on_roster" }]);
    expect(r.eligible).toEqual(["m2"]);
  });

  it("keeps the order the member selected", () => {
    const r = decideAppealEligibility({ requested: ["c", "a", "b"], onRoster: ["a"] });

    expect(r.eligible).toEqual(["c", "b"]);
  });

  it("reports on_roster ahead of inactive, since it is the truthful reason", () => {
    const r = decideAppealEligibility({ requested: ["m1"], onRoster: ["m1"], inactive: ["m1"] });

    expect(r.blocked).toEqual([{ member_id: "m1", reason: "on_roster" }]);
  });

  it("handles a missing input list as empty rather than throwing", () => {
    const r = decideAppealEligibility({ requested: ["m1", "m2"] });

    expect(r.eligible).toEqual(["m1", "m2"]);
    expect(r.blocked).toEqual([]);
  });
});

describe("explainBlocked", () => {
  it("uses one message for present and already-pending", () => {
    // The member cannot act differently on either, so splitting the message would only
    // make them wonder which applies.
    const msg = explainBlocked([
      { member_id: "m1", reason: "on_roster" },
      { member_id: "m2", reason: "already_pending" },
    ]);

    expect(msg).toContain("already on the attendance list");
    expect(msg).toContain("pending appeal");
  });

  it("calls out an inactive member specifically", () => {
    const msg = explainBlocked([{ member_id: "m1", reason: "inactive" }]);

    expect(msg).toContain("no longer active");
  });

  it("prefers the inactive message when one appears among others", () => {
    const msg = explainBlocked([
      { member_id: "m1", reason: "on_roster" },
      { member_id: "m2", reason: "inactive" },
    ]);

    expect(msg).toContain("no longer active");
  });
});
