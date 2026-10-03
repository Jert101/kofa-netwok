import { describe, expect, it } from "vitest";
import { buildLiturgySheetPdf } from "./sheet-pdf";
import type { SheetInput, SheetMass, SheetSlot } from "./sheet";

function slot(position_label: string, member_name: string | null): SheetSlot {
  return { position_label, member_name };
}

function mass(count: number, name = "Anticipated"): SheetMass {
  return {
    mass_id: `m-${name}`,
    mass_name: name,
    time_label: "5:30 AM",
    slots: Array.from({ length: count }, (_, i) => slot(`Position ${i + 1}`, "Reyes, Ben")),
  };
}

const GENERATED_AT = new Date("2026-10-02T14:15:00.000Z");

function sheet(masses: SheetMass[]): SheetInput {
  return {
    churchName: "St. Mary",
    churchAddress: "1 Church Street",
    dateLabel: "Sunday, October 5, 2026",
    generatedAt: GENERATED_AT,
    generatedAtLabel: "Generated: Oct 2, 2026, 2:15 PM",
    masses,
  };
}

/** jsPDF writes a real PDF; this is the byte signature, cheap enough to assert on. */
function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

/**
 * Everything the renderer drew, i.e. the document up to its trailer.
 *
 * jsPDF generates a random trailer `/ID` per document, so two renders of identical input are
 * never byte-for-byte equal no matter how stable the layout is. Comparing the drawn body is the
 * property worth holding.
 */
function drawnBody(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const trailerAt = raw.indexOf("trailer");
  expect(trailerAt).toBeGreaterThan(0);
  return raw.slice(0, trailerAt);
}

describe("buildLiturgySheetPdf", () => {
  it("renders a real PDF", () => {
    const out = buildLiturgySheetPdf(sheet([mass(9)]));
    expect(isPdf(out.bytes)).toBe(true);
    expect(out.bytes.byteLength).toBeGreaterThan(500);
  });

  it("puts a three-Mass Sunday on one page", () => {
    // The acceptance criterion, checked on the rendered document rather than the arithmetic.
    const out = buildLiturgySheetPdf(sheet([mass(9), mass(9, "Midnight"), mass(6, "Solemnity")]));
    expect(out.pages).toBe(1);
    expect(out.onePage).toBe(true);
  });

  it("puts a single nine-position Mass on one page", () => {
    expect(buildLiturgySheetPdf(sheet([mass(9)])).pages).toBe(1);
  });

  it("puts two Masses side by side on one page", () => {
    expect(buildLiturgySheetPdf(sheet([mass(6), mass(6, "Midnight")])).pages).toBe(1);
  });

  it("paginates a date far past one page instead of overlapping the footer", () => {
    const out = buildLiturgySheetPdf(sheet([mass(120)]));
    expect(out.pages).toBeGreaterThan(1);
    expect(out.onePage).toBe(false);
  });

  it("draws an identical sheet for the same input", () => {
    // A layout that depended on iteration order or on the clock would draw differently for the
    // same data, which makes it impossible to tell a layout change from a rendering one.
    const a = buildLiturgySheetPdf(sheet([mass(9), mass(4, "Midnight")]));
    const b = buildLiturgySheetPdf(sheet([mass(9), mass(4, "Midnight")]));
    expect(drawnBody(a.bytes)).toBe(drawnBody(b.bytes));
    expect(a.pages).toBe(b.pages);
  });

  it("draws something different when the data changes", () => {
    // The companion to the stability test: without this, a sheet that drew nothing at all would
    // pass both.
    const a = buildLiturgySheetPdf(sheet([mass(9)]));
    const b = buildLiturgySheetPdf(sheet([mass(8)]));
    expect(drawnBody(a.bytes)).not.toBe(drawnBody(b.bytes));
  });

  it("renders a date with no Masses at all without throwing", () => {
    const out = buildLiturgySheetPdf(sheet([]));
    expect(isPdf(out.bytes)).toBe(true);
    expect(out.pages).toBe(1);
  });

  it("renders every position unassigned", () => {
    const empty: SheetMass = {
      mass_id: "m",
      mass_name: "Anticipated",
      time_label: null,
      slots: [slot("Crucifix", null), slot("Thurifer", null)],
    };
    const out = buildLiturgySheetPdf(sheet([empty]));
    expect(out.pages).toBe(1);
  });

  it("survives a very long name rather than throwing", () => {
    const long: SheetMass = {
      mass_id: "m",
      mass_name: "Anticipated",
      time_label: null,
      slots: [slot("Crucifix", "A".repeat(400))],
    };
    expect(() => buildLiturgySheetPdf(sheet([long]))).not.toThrow();
  });
});