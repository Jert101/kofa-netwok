import { describe, expect, it } from "vitest";

import { MAX_DAYS, datesInRange, drawSlots, type BulkMember } from "./bulk-assign";
import type { TemplatePosition } from "./rules";

function member(id: string, gender: string | null): BulkMember {
  return { id, full_name: `Member ${id}`, gender };
}

const roll: BulkMember[] = [
  member("m1", "female"),
  member("m2", "male"),
  member("m3", "male"),
  member("m4", "female"),
];

const anyRule = (position_label: string): TemplatePosition => ({
  position_label,
  required_gender: "any",
});

describe("datesInRange", () => {
  it("includes both ends", () => {
    expect(datesInRange("2026-01-04", "2026-01-06")).toEqual([
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
    ]);
  });

  it("returns one date when the range is a single day", () => {
    expect(datesInRange("2026-01-04", "2026-01-04")).toEqual(["2026-01-04"]);
  });

  it("crosses a month and a year boundary", () => {
    expect(datesInRange("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("returns nothing when the end is before the start", () => {
    expect(datesInRange("2026-01-06", "2026-01-04")).toEqual([]);
  });

  it("caps an absurd range rather than generating thousands of dates", () => {
    expect(datesInRange("2020-01-01", "2030-01-01")).toHaveLength(MAX_DAYS);
  });
});

describe("drawSlots", () => {
  it("fills one slot per position", () => {
    const { slots, unfilled } = drawSlots(
      [anyRule("Crucifix"), anyRule("Thurifer")],
      roll,
      new Set(),
      () => 0,
    );
    expect(slots.map((s) => s.position_label)).toEqual(["Crucifix", "Thurifer"]);
    expect(unfilled).toBe(0);
  });

  it("only draws the gender the position asks for", () => {
    const { slots } = drawSlots(
      [{ position_label: "Thurifer", required_gender: "female" }],
      roll,
      new Set(),
      () => 0,
    );
    expect(["m1", "m4"]).toContain(slots[0].member_id);
  });

  it("treats a member with no recorded gender as matching only an open position", () => {
    const withUnknown = [...roll, member("m5", null)];
    const open = drawSlots([anyRule("Lector")], withUnknown, new Set(), () => 0);
    expect(open.unfilled).toBe(0);
    const female = drawSlots(
      [{ position_label: "Lector", required_gender: "female" }],
      withUnknown,
      new Set(),
      () => 0,
    );
    expect(female.slots[0].member_id).not.toBe("m5");
  });

  it("never draws the same person twice within one call", () => {
    const { slots } = drawSlots(
      [anyRule("A"), anyRule("B"), anyRule("C")],
      [member("m1", "male"), member("m2", "male")],
      new Set(),
      () => 0,
    );
    const ids = slots.map((s) => s.member_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("respects a member who is already serving earlier in the day", () => {
    const { slots, unfilled } = drawSlots([anyRule("A"), anyRule("B")], roll, new Set(["m1", "m2"]), () => 0);
    expect(slots.map((s) => s.member_id).sort()).toEqual(["m3", "m4"]);
    expect(unfilled).toBe(0);
  });

  it("leaves a position open rather than filling it with someone who does not fit", () => {
    const { slots, unfilled } = drawSlots(
      [{ position_label: "Thurifer", required_gender: "female" }],
      [member("m2", "male")],
      new Set(),
      () => 0,
    );
    expect(slots).toHaveLength(0);
    expect(unfilled).toBe(1);
  });

  it("leaves a position open when the only matching member is already serving", () => {
    const { slots, unfilled } = drawSlots(
      [{ position_label: "Thurifer", required_gender: "female" }],
      [member("m1", "female")],
      new Set(["m1"]),
      () => 0,
    );
    expect(slots).toHaveLength(0);
    expect(unfilled).toBe(1);
  });

  it("grows the day-wide set so the next Mass of the same day cannot reuse anyone", () => {
    const used = new Set<string>();
    const first = drawSlots([anyRule("A")], [member("m1", "male")], used, () => 0);
    const second = drawSlots([anyRule("A")], [member("m1", "male")], used, () => 0);
    expect(first.slots[0].member_id).toBe("m1");
    expect(second.unfilled).toBe(1);
    expect(second.slots).toHaveLength(0);
  });

  it("reaches every candidate when the random source is walked across it", () => {
    // Sanity check that the pool is not accidentally collapsed to one member.
    const picks = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      const { slots } = drawSlots([anyRule("A")], [member("m1", "male"), member("m2", "male")], new Set(), () => i / 4);
      picks.add(slots[0].member_id);
    }
    expect(picks).toEqual(new Set(["m1", "m2"]));
  });
});