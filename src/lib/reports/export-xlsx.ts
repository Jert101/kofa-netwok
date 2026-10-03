import ExcelJS from "exceljs";
import { buildExportTable, type ExportTable } from "@/lib/reports/export";
import type { ReportGridSnapshot } from "@/lib/reports/weekend-grid";

/**
 * Server-only. Kept apart from `export.ts` so the CSV and the table builder stay pure and
 * importable from a test without pulling in a spreadsheet engine.
 */

const HEADER_FILL = "FF1F2937";
const SERVED_FILL = "FFDCFCE7";
const ABSENT_FILL = "FFFEE2E2";

export async function buildXlsx(grid: ReportGridSnapshot): Promise<Buffer> {
  const table = buildExportTable(grid);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Attendance Reports";
  const ws = wb.addWorksheet("Attendance", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });

  // Written as a single row of cells rather than ws.columns, because the widths depend on the
  // number of Mass columns, which is only known once the grid is built.
  ws.addRow(table.header);

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;

  for (const row of table.rows) {
    const added = ws.addRow(row) as ExcelJS.Row;

    // Columns 2..1+grid.columns.length are the S/A marks; the first column is the name and
    // the last two are the count and remarks, which stay unstyled.
    for (let i = 0; i < grid.columns.length; i++) {
      const cell = added.getCell(i + 2);
      const served = row[i + 1] === "Served";
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: served ? SERVED_FILL : ABSENT_FILL },
      };
      cell.alignment = { horizontal: "center" };
    }
  }

  ws.getColumn(1).width = 30;
  for (let i = 0; i < grid.columns.length; i++) {
    ws.getColumn(i + 2).width = 14;
  }
  ws.getColumn(grid.columns.length + 2).width = 14;
  ws.getColumn(grid.columns.length + 3).width = 20;

  // Filtering on the header row is what makes the file useful for a secretary reconciling
  // against a printed roster, and it costs nothing.
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: table.header.length },
  };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export type { ExportTable };
