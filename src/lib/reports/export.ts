import type { ReportGridColumn, ReportGridSnapshot } from "@/lib/reports/weekend-grid";

/**
 * RPT-7: XLSX and CSV of the stored grid.
 *
 * Both formats are produced from one intermediate table built here, because the acceptance
 * criterion is that they "match the grid" — building each format from the snapshot
 * separately would make that a coincidence to be maintained rather than a property.
 *
 * The snapshot is the only input. Nothing is re-read from the attendance tables, which is
 * what lets an archived report still export.
 */

export type ExportTable = {
  header: string[];
  rows: string[][];
};

const SERVED = "Served";
const ABSENT = "Absent";

/**
 * The grid as a flat table.
 *
 * Two header rows would preserve the date grouping, but neither CSV nor a single-row
 * header can express "two Masses on the same day", so each column is labelled
 * `date · Mass name` on one line. Flat, unambiguous, and openable in every spreadsheet.
 */
export function buildExportTable(grid: ReportGridSnapshot): ExportTable {
  const header = [
    "Full name",
    ...grid.columns.map(columnLabel),
    "Masses served",
    "Remarks",
  ];

  const rows = grid.rows.map((row) => [
    row.name,
    // Bounded to the header width rather than trusting the stored cells. A snapshot whose
    // cells and columns disagree would otherwise emit a CSV with a rectangular header and a
    // ragged body, which some spreadsheet parsers silently truncate on open — losing the
    // served count without any error. Padding a short row is equally deliberate: a missing
    // cell is visible as a blank, a missing column is not.
    ...padTo(row.cells, grid.columns.length).map((cell) => (cell === "S" ? SERVED : ABSENT)),
    String(row.served),
    row.remarks,
  ]);

  return { header, rows };
}

function padTo<T>(values: T[], width: number): T[] {
  if (values.length >= width) return values.slice(0, width);
  return [...values, ...Array<T>(width - values.length).fill("A" as T)];
}

export function columnLabel(column: ReportGridColumn): string {
  return `${column.date} · ${column.massName}`;
}

/**
 * RFC 4180 CSV.
 *
 * Quoting is unconditional for any field containing a comma, quote, CR or LF, and inner
 * quotes are doubled. Member names come from a parish secretary typing them into a free-text
 * field, so a name like `O'Brien, Ana` is a matter of when, not if.
 */
export function toCsv(table: ExportTable): string {
  const lines = [table.header, ...table.rows].map((row) =>
    row.map(csvField).join(","),
  );
  // Trailing CRLF: Excel on Windows treats a final line without a terminator as incomplete.
  return `${lines.join("\r\n")}\r\n`;
}

function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Filename stem for Content-Disposition. Strips anything a header would reject. */
export function exportFileStem(title: string, format: "xlsx" | "csv"): string {
  const safe = title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    // Punctuation stripping leaves runs of dashes behind, e.g. "rm -rf" -> "rm--rf".
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || "attendance-report"}.${format}`;
}
