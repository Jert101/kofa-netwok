/**
 * LIT-7: the sacristy sheet.
 *
 * "One page A4, up to three Masses" is the acceptance criterion, and it is the only part of this
 * that can fail silently — a sheet that spills onto a second page is useless in a sacristy and
 * looks fine in a viewer. So the layout is worked out here as plain arithmetic, tested, and only
 * then handed to jsPDF.
 *
 * The sizing rule that makes one page work: the row height is solved backwards from the page.
 * Given a header height, the available body and the number of rows, pick the one row height at
 * which everything still fits, and only then shrink the font. Reducing the font instead would
 * make a nine-position Mass unreadable to fix a layout problem.
 */

export type SheetSlot = {
  position_label: string;
  /** Display name, or null when the position has nobody in it yet. */
  member_name: string | null;
  /**
   * Whether `member_name` is somebody typed in by hand rather than a roster member.
   *
   * Optional and unused by the sheet itself: a printed page has no way to mark a guest
   * usefully, and the distinction only matters in the editor. Callers that have the information
   * may pass it; the sheet ignores it.
   */
  is_guest?: boolean;
};

export type SheetMass = {
  mass_id: string;
  mass_name: string;
  /** `HH:MM` or null when the Mass has no configured time. */
  time_label: string | null;
  slots: SheetSlot[];
};

/** "Sunday, 5 October 2026" from a `YYYY-MM-DD` date. UTC-pinned, like every date in this module. */
export function formatLongDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export type SheetInput = {
  churchName: string;
  churchAddress: string;
  dateLabel: string;
  /**
   * When the sheet was produced.
   *
   * Passed in rather than read inside the renderer so the printed "Generated:" line and the PDF's
   * own metadata come from one clock, and so re-rendering identical data yields identical bytes.
   */
  generatedAt: Date;
  generatedAtLabel: string;
  masses: SheetMass[];
};

/** A4 portrait, in points. */
export const PAGE = { width: 595.28, height: 841.89, margin: 40 } as const;

const HEADER_H = 96;
const MASS_HEADING_H = 22;
const MASS_GAP = 16;
const FOOTER_H = 26;
const ROW_MIN_H = 9;
const ROW_MAX_H = 18;

/** Usable vertical space for the Mass blocks on one page. */
export function availableBodyHeight(): number {
  return PAGE.height - PAGE.margin - FOOTER_H - (PAGE.margin + HEADER_H);
}

/** Height consumed by Mass headings and the gaps between them, i.e. everything but the rows. */
function fixedBlocksHeight(massCount: number): number {
  return massCount * MASS_HEADING_H + Math.max(massCount - 1, 0) * MASS_GAP;
}

/**
 * The most positions that will fit on one page for a date with this many Masses.
 *
 * Exposed because the caller has to decide something before it draws: a date beyond this capacity
 * has to paginate, and it is only fair to warn the officer that the sheet came out on two pages.
 */
export function maxRowsForOnePage(massCount: number): number {
  const room = availableBodyHeight() - fixedBlocksHeight(Math.max(massCount, 1));
  return Math.max(Math.floor(room / ROW_MIN_H), 0);
}

export type SheetLayout = {
  rowHeight: number;
  fontSize: number;
  /** Sum of every block; a layout is only valid when this fits the page. */
  totalHeight: number;
  fits: boolean;
};

/**
 * Solve the row height for a one-page sheet.
 *
 * Rows are counted per Mass, because that is what the page is actually made of: a Mass with three
 * positions is three rows, and a Mass with nine is nine. Sizing off the tallest Mass instead would
 * either waste most of the page or overflow.
 */
export function layoutSheet(masses: SheetMass[]): SheetLayout {
  const available = Math.max(availableBodyHeight(), 1);

  const rows = masses.reduce((n, m) => n + m.slots.length, 0);
  const fixed = fixedBlocksHeight(masses.length);
  const rowSpace = available - fixed;

  if (rows === 0) {
    return {
      rowHeight: ROW_MIN_H,
      fontSize: 9,
      totalHeight: fixed,
      fits: fixed <= available,
    };
  }

  // A page that cannot fit every row even at the smallest permitted height is reported rather
  // than rendered: the caller is expected to fall back to letting jsPDF paginate and warn.
  const ideal = rowSpace / rows;
  const rowHeight = Math.max(ROW_MIN_H, Math.min(ROW_MAX_H, ideal));
  const totalHeight = fixed + rows * rowHeight;

  // The font is derived from the row height so text always has room inside its own row.
  const fontSize = Math.max(6.5, Math.min(10, Math.floor(rowHeight * 0.62)));

  return { rowHeight, fontSize, totalHeight, fits: totalHeight <= available + 0.5 };
}

/**
 * Group rows by position so a position with two people prints as one block with two names.
 *
 * Spec §4 keeps multi-server positions working, and printing "Candle 1" twice as two separate rows
 * would read as two positions on a sheet somebody is using to find out who is doing what.
 */
export function groupSlotsForSheet(slots: SheetSlot[]): Array<{
  position_label: string;
  names: string[];
  unassigned: boolean;
}> {
  const order: string[] = [];
  const map = new Map<string, { label: string; names: string[] }>();

  for (const slot of slots) {
    const key = positionKey(slot.position_label);
    if (key.length === 0) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = { label: normalize(slot.position_label), names: [] };
      map.set(key, entry);
      order.push(key);
    }
    const name = slot.member_name?.trim();
    if (name && name.length > 0 && !entry.names.includes(name)) {
      entry.names.push(name);
    }
  }

  return order.map((key) => {
    const entry = map.get(key)!;
    return {
      position_label: entry.label,
      names: entry.names,
      unassigned: entry.names.length === 0,
    };
  });
}

/** The key positions are grouped by: whitespace collapsed, case folded. */
function positionKey(raw: string): string {
  return normalize(raw).toLowerCase();
}

function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Separates two people at the same position. Not a comma: names already contain one. */
export const NAME_SEPARATOR = " · ";

/**
 * Collapse each Mass to what actually gets printed: one row per position, names joined.
 *
 * This has to happen *before* the page is measured. Two rows for "Candle 1" become one printed
 * block, so laying the page out against the raw row count would reserve height for a row that is
 * never drawn and push a sheet that would have fitted onto a second page.
 */
export function toPrintMasses(masses: SheetMass[]): SheetMass[] {
  return masses.map((m) => ({
    mass_id: m.mass_id,
    mass_name: m.mass_name,
    time_label: m.time_label,
    slots: groupSlotsForSheet(m.slots).map((block) => ({
      position_label: block.position_label,
      member_name: block.names.length > 0 ? block.names.join(NAME_SEPARATOR) : null,
    })),
  }));
}

/**
 * Split a date's Masses across the columns of the sheet.
 *
 * Up to three Masses print side by side, which is what keeps a three-Mass Sunday on one page. A
 * fourth Mass stacks below rather than shrinking everything further: the spec's acceptance
 * criterion is three, and a readable two-column sheet beats an unreadable four-column one.
 */
export function columnCountFor(masses: SheetMass[]): number {
  return masses.length <= 3 ? Math.max(masses.length, 1) : 2;
}