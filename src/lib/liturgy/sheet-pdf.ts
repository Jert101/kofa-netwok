import { jsPDF } from "jspdf";
import {
  NAME_SEPARATOR,
  PAGE,
  columnCountFor,
  layoutSheet,
  maxRowsForOnePage,
  toPrintMasses,
  type SheetInput,
  type SheetMass,
} from "./sheet";

/**
 * LIT-7 rendering.
 *
 * The drawing is deliberately thin — all the sizing decisions live in `./sheet` as arithmetic that
 * is unit tested, so what remains here is putting lines and words at those coordinates.
 *
 * Unassigned positions are tinted rather than merely blank. On paper, a blank line reads as
 * "nothing here yet, never mind" and the whole point of a needs-attention workflow is that an empty
 * position is something to chase.
 */

const INK: [number, number, number] = [28, 28, 28];
const MUTED: [number, number, number] = [120, 120, 120];
const BAND: [number, number, number] = [41, 61, 51];
const BAND_TEXT: [number, number, number] = [255, 255, 255];
const RULE: [number, number, number] = [210, 210, 210];
const GAP_FILL: [number, number, number] = [253, 238, 238];
const GAP_INK: [number, number, number] = [170, 40, 40];
const ZEBRA: [number, number, number] = [248, 248, 247];

const HEADING_H = 22;
const GAP = 16;
const FOOTER_H = 26;
const COL_GUTTER = 14;

export type SheetPdfResult = {
  /**
   * `ArrayBuffer`-backed on purpose. A bare `Uint8Array` widens to `Uint8Array<ArrayBufferLike>`,
   * which is not assignable to `BodyInit` because that union admits `SharedArrayBuffer`, and a
   * response body cannot be one. See `src/app/api/reports/[id]/pdf/route.ts`.
   */
  bytes: Uint8Array<ArrayBuffer>;
  pages: number;
  /** False when the date held more positions than one A4 page can carry. */
  onePage: boolean;
};

export function buildLiturgySheetPdf(input: SheetInput): SheetPdfResult {
  // Collapse first, then measure: rows that merge into one position must not reserve page height.
  const printMasses = toPrintMasses(input.masses);
  const layout = layoutSheet(printMasses);
  const columns = columnCountFor(printMasses);

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  // Pinned to the caller's timestamp rather than "now": the header line and the document metadata
  // then agree, and two renders of the same date produce the same bytes.
  doc.setCreationDate(input.generatedAt);
  const innerW = PAGE.width - PAGE.margin * 2;
  const colW = innerW / columns;
  const blockW = colW - COL_GUTTER;

  let y = drawHeader(doc, input);

  // Positions flow down the first column, then into the next, rather than being balanced. Balancing
  // looks tidier on screen but puts a Mass's positions far from its heading on a printed page.
  let col = 0;
  for (const mass of printMasses) {
    const x = PAGE.margin + col * colW;

    y = ensureSpace(doc, y, HEADING_H, input);
    drawMassHeading(doc, mass, x, y, blockW, layout.fontSize);
    y += HEADING_H;

    for (const [i, slot] of mass.slots.entries()) {
      if (y + layout.rowHeight > PAGE.height - PAGE.margin - FOOTER_H) {
        // This Mass runs long: finish the column rather than overlapping the footer.
        col += 1;
        if (col >= columns) {
          col = 0;
          doc.addPage();
          y = drawContinuationHeader(doc, input);
        } else {
          y = PAGE.margin;
        }
        break;
      }
      y = drawPositionRow(doc, slot, x, y, blockW, layout.rowHeight, layout.fontSize, i);
    }

    if (col === 0) y += GAP;
    else y += GAP;

    if (col >= columns) {
      col = 0;
      doc.addPage();
      y = drawContinuationHeader(doc, input);
    }
  }

  const pages = doc.getNumberOfPages();
  stampFooters(doc, input, pages);

  return {
    // Uint8Array rather than the Buffer: Buffer<ArrayBufferLike> is not assignable to BodyInit,
    // since that union admits SharedArrayBuffer, which a response body cannot be.
    bytes: new Uint8Array(doc.output("arraybuffer")),
    pages,
    onePage: pages === 1 && layout.fits,
  };
}

// ======================================================================================
// Fixed furniture
// ======================================================================================

function drawHeader(doc: jsPDF, input: SheetInput): number {
  let y = PAGE.margin;

  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(input.churchName || "Church", PAGE.margin, y);
  y += 20;

  if (input.churchAddress) {
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(input.churchAddress, PAGE.margin, y);
    y += 13;
  }

  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text("Ministry Schedule", PAGE.margin, y);
  y += 17;

  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(input.dateLabel, PAGE.margin, y);

  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(input.generatedAtLabel, PAGE.width - PAGE.margin, y, { align: "right" });

  y += 8;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.75);
  doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);

  return y + 16;
}

/**
 * Pages after the first repeat the date. A sheet that silently loses its date on page two is how a
 * stack of printed schedules gets separated from the day it belongs to.
 */
function drawContinuationHeader(doc: jsPDF, input: SheetInput): number {
  const y = PAGE.margin;
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`${input.churchName || "Church"} — ${input.dateLabel} (continued)`, PAGE.margin, y);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  doc.line(PAGE.margin, y + 5, PAGE.width - PAGE.margin, y + 5);
  return y + 20;
}

function stampFooters(doc: jsPDF, input: SheetInput, pages: number): void {
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      pages > 1 ? `Page ${i} of ${pages}` : input.generatedAtLabel,
      PAGE.width / 2,
      PAGE.height - PAGE.margin + 12,
      { align: "center" },
    );
  }
}

/** Add a page when the next block would not fit, and return the y to draw it at. */
function ensureSpace(doc: jsPDF, y: number, needed: number, input: SheetInput): number {
  if (y + needed <= PAGE.height - PAGE.margin - FOOTER_H) return y;
  doc.addPage();
  return drawContinuationHeader(doc, input);
}

// ======================================================================================
// Content
// ======================================================================================

function drawMassHeading(
  doc: jsPDF,
  mass: SheetMass,
  x: number,
  y: number,
  w: number,
  fontSize: number,
): void {
  doc.setFillColor(...BAND);
  doc.rect(x, y, w, HEADING_H, "F");

  doc.setFontSize(Math.max(9, fontSize + 1.5));
  doc.setTextColor(...BAND_TEXT);
  const time = mass.time_label ? ` — ${mass.time_label}` : "";
  doc.text(`${mass.mass_name}${time}`, x + 8, y + HEADING_H / 2 + 3.5, {
    maxWidth: w - 16,
  });
}

function drawPositionRow(
  doc: jsPDF,
  slot: { position_label: string; member_name: string | null },
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  index: number,
): number {
  const unassigned = slot.member_name === null;

  if (unassigned) {
    doc.setFillColor(...GAP_FILL);
    doc.rect(x, y, w, h, "F");
  } else if (index % 2 === 1) {
    // Only every other row: stripes are for tracking a name across a column, and heavy rules are
    // for reading a name inside one row. Both at once is just noise.
    doc.setFillColor(...ZEBRA);
    doc.rect(x, y, w, h, "F");
  }

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.25);
  doc.rect(x, y, w, h, "S");

  const labelW = Math.min(Math.max(w * 0.42, 60), w - 50);
  const midY = y + h / 2 + fontSize * 0.35;

  doc.setFontSize(fontSize);
  doc.setTextColor(...INK);
  doc.text(slot.position_label, x + 7, midY, { maxWidth: labelW - 10 });

  if (unassigned) {
    doc.setTextColor(...GAP_INK);
    doc.text("— not assigned —", x + labelW + 4, midY, { maxWidth: w - labelW - 10 });
  } else {
    doc.setTextColor(...INK);
    // Multiple servers at one position are joined by NAME_SEPARATOR. jsPDF will happily wrap that
    // across two lines and print them over the neighbouring row, so it is clipped to the single
    // line the row has room for.
    const avail = w - labelW - 10;
    const lines = doc.splitTextToSize(slot.member_name ?? "", avail) as string[];
    const one = lines[0] ?? "";
    const clipped = lines.length > 1 && one.length > 1 ? `${one.slice(0, -1)}…` : one;
    doc.text(clipped, x + labelW + 4, midY);
  }

  return y + h;
}

/** How many printed rows a date holds, for the caller's "this came out on two pages" warning. */
export function sheetCapacity(masses: SheetMass[]): number {
  return maxRowsForOnePage(toPrintMasses(masses).length);
}

export { NAME_SEPARATOR };