import { describe, expect, it } from "vitest";
import {
  availableBodyHeight,
  columnCountFor,
  groupSlotsForSheet,
  layoutSheet,
  maxRowsForOnePage,
  toPrintMasses,
  type SheetMass,
  type SheetSlot,
} from "./sheet";

function slot(position_label: string, member_name: string | null): SheetSlot {
  return { position_label, member_name, is_guest: member_name !== null && !member_name.includes(",") };
}

function mass(slots: SheetSlot[], name = "Anticipated"): SheetMass {
  return { mass_id: "m1", mass_name: name, time_label: "5:30 AM", slots };
}

function rows(n: number): SheetSlot[] {
  return Array.from({ length: n }, (_, i) => slot(`Position ${i + 1}`, `Reyes, Ben`));
}

const AVAILABLE = availableBodyHeight();

/**
 * Rows past which one page genuinely runs out of space, derived rather than guessed: at the 9pt
 * row minimum the body holds AVAILABLE / 9 blocks, so anything beyond that cannot fit no matter
 * how the layout is solved.
 */
const OVERFLOW_ROWS = Math.ceil(AVAILABLE / 9) + 12;

// ======================================================================================
// One page
// ======================================================================================

describe("layoutSheet", () => {
  it("keeps a three-Mass Sunday on one page", () => {
    // The acceptance criterion: one A4 page for a date with up to three Masses.
    const layout = layoutSheet([mass(rows(9)), mass(rows(9), "Midnight"), mass(rows(6), "Solemnity")]);
    expect(layout.fits).toBe(true);
    expect(layout.totalHeight).toBeLessThanOrEqual(AVAILABLE);
  });

  it("keeps a single Mass with nine positions on one page", () => {
    const layout = layoutSheet([mass(rows(9))]);
    expect(layout.fits).toBe(true);
  });

  it("reports rather than throws when the rows cannot fit", () => {
    // Past what a one-page sheet can hold; the caller needs to know so it can paginate and say so,
    // not so it can crash mid-print.
    const layout = layoutSheet([mass(rows(OVERFLOW_ROWS))]);
    expect(layout.fits).toBe(false);
    expect(layout.rowHeight).toBeGreaterThan(0);
  });

  it("never gives a row less than the readable minimum", () => {
    const layout = layoutSheet([mass(rows(OVERFLOW_ROWS))]);
    expect(layout.rowHeight).toBe(9);
  });

  it("never inflates a short sheet past the maximum row height", () => {
    const layout = layoutSheet([mass(rows(2))]);
    expect(layout.rowHeight).toBeLessThanOrEqual(18);
  });

  it("sizes a longer list to a smaller row height", () => {
    const short = layoutSheet([mass(rows(3))]);
    const long = layoutSheet([mass(rows(OVERFLOW_ROWS - 5))]);
    expect(long.rowHeight).toBeLessThan(short.rowHeight);
  });

  it("still fits exactly the capacity it advertises, and one row more does not", () => {
    // The boundary case: the advertised capacity has to agree with the layout it produces, or the
    // route's "this came out on two pages" warning would be wrong either side of the line.
    const cap = maxRowsForOnePage(1);
    expect(layoutSheet([mass(rows(cap))]).fits).toBe(true);
    expect(layoutSheet([mass(rows(cap + 1))]).fits).toBe(false);
  });

  it("shrinks the font with the row, so text stays inside it", () => {
    const layout = layoutSheet([mass(rows(20))]);
    expect(layout.fontSize).toBeLessThanOrEqual(layout.rowHeight * 0.75);
    expect(layout.fontSize).toBeGreaterThanOrEqual(6.5);
  });

  it("fits a date with three empty Masses", () => {
    const layout = layoutSheet([mass([]), mass([], "Midnight"), mass([], "Solemnity")]);
    expect(layout.fits).toBe(true);
  });

  it("fits a date with nothing on it", () => {
    const layout = layoutSheet([]);
    expect(layout.fits).toBe(true);
    expect(layout.rowHeight).toBeGreaterThan(0);
  });

  it("costs more height for two Masses than one", () => {
    const one = layoutSheet([mass(rows(4))]);
    const two = layoutSheet([mass(rows(4)), mass(rows(4), "Midnight")]);
    expect(two.totalHeight).toBeGreaterThan(one.totalHeight);
  });
});

// ======================================================================================
// Grouping
// ======================================================================================

describe("groupSlotsForSheet", () => {
  it("makes one block per position", () => {
    const out = groupSlotsForSheet([slot("Crucifix", "Santos, Ana"), slot("Thurifer", "Reyes, Ben")]);
    expect(out.map((b) => b.position_label)).toEqual(["Crucifix", "Thurifer"]);
  });

  it("puts two people at one position in the same block", () => {
    const out = groupSlotsForSheet([
      slot("Candle 1", "Santos, Ana"),
      slot("Candle 1", "Reyes, Ben"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].names).toEqual(["Santos, Ana", "Reyes, Ben"]);
  });

  it("marks a position with nobody in it", () => {
    const out = groupSlotsForSheet([slot("Crucifix", null)]);
    expect(out[0].unassigned).toBe(true);
    expect(out[0].names).toEqual([]);
  });

  it("collapses case-variant labels into one position", () => {
    const out = groupSlotsForSheet([slot("Crucifix", "A"), slot("crucifix", "B")]);
    expect(out).toHaveLength(1);
  });

  it("keeps the label as first typed", () => {
    const out = groupSlotsForSheet([slot("Crucifix", "A"), slot("crucifix", "B")]);
    expect(out[0].position_label).toBe("Crucifix");
  });

  it("collapses whitespace in the label it prints", () => {
    const out = groupSlotsForSheet([slot("  Candle   1 ", "A")]);
    expect(out[0].position_label).toBe("Candle 1");
  });

  it("counts a position with one name and one blank as filled", () => {
    const out = groupSlotsForSheet([slot("Crucifix", "A"), slot("Crucifix", null)]);
    expect(out[0].unassigned).toBe(false);
    expect(out[0].names).toEqual(["A"]);
  });

  it("does not repeat the same name twice", () => {
    const out = groupSlotsForSheet([slot("Crucifix", "Santos, Ana"), slot("Crucifix", "Santos, Ana")]);
    expect(out[0].names).toEqual(["Santos, Ana"]);
  });

  it("drops a row with a blank label", () => {
    expect(groupSlotsForSheet([slot("   ", "A")])).toEqual([]);
  });

  it("keeps first-seen order", () => {
    const out = groupSlotsForSheet([
      slot("Thurifer", "A"),
      slot("Crucifix", "B"),
      slot("Thurifer", "C"),
    ]);
    expect(out.map((b) => b.position_label)).toEqual(["Thurifer", "Crucifix"]);
  });
});

// ======================================================================================
// Labels and columns
// ======================================================================================

describe("toPrintMasses", () => {
  it("leaves one row per position when every label is distinct", () => {
    const out = toPrintMasses([mass([slot("Crucifix", "A"), slot("Thurifer", "B")])]);
    expect(out[0].slots.map((s) => s.position_label)).toEqual(["Crucifix", "Thurifer"]);
  });

  it("joins two people at one position into a single row", () => {
    const out = toPrintMasses([
      mass([slot("Candle 1", "Santos, Ana"), slot("Candle 1", "Reyes, Ben")]),
    ]);
    expect(out[0].slots).toHaveLength(1);
    expect(out[0].slots[0].member_name).toBe("Santos, Ana · Reyes, Ben");
  });

  it("keeps a blank name null so the row prints as unassigned", () => {
    const out = toPrintMasses([mass([slot("Crucifix", null)])]);
    expect(out[0].slots[0].member_name).toBeNull();
  });

  it("carries the Mass name and time through", () => {
    const out = toPrintMasses([mass([slot("Crucifix", "A")], "Midnight")]);
    expect(out[0].mass_name).toBe("Midnight");
    expect(out[0].time_label).toBe("5:30 AM");
  });

  it("measures the page against printed rows, not raw rows", () => {
    // Four rows collapse to two positions, so the sheet must be laid out as if there were two.
    const duplicated = [mass([slot("Candle 1", "A"), slot("Candle 1", "B"), slot("Candle 1", "C"), slot("Candle 1", "D")])];
    const print = toPrintMasses(duplicated);
    expect(print[0].slots).toHaveLength(1);
    expect(layoutSheet(print).rowHeight).toBe(layoutSheet([mass(rows(1))]).rowHeight);
  });

  it("handles a date with no Masses", () => {
    expect(toPrintMasses([])).toEqual([]);
  });
});

describe("columnCountFor", () => {
  it("prints up to three Masses side by side", () => {
    expect(columnCountFor([mass([])])).toBe(1);
    expect(columnCountFor([mass([]), mass([])])).toBe(2);
    expect(columnCountFor([mass([]), mass([]), mass([])])).toBe(3);
  });

  it("stacks a fourth Mass rather than shrinking to four columns", () => {
    const four = [mass([]), mass([]), mass([]), mass([])];
    expect(columnCountFor(four)).toBe(2);
  });

  it("never reports zero columns for an empty date", () => {
    expect(columnCountFor([])).toBe(1);
  });
});