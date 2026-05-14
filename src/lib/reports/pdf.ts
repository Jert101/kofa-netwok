import { format, parseISO } from "date-fns";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { ReportDateGroup } from "@/lib/reports/weekend-grid";

export type GridMemberRow = {
  memberId: string;
  fullName: string;
  cells: ("served" | "absent")[];
  remarks: string;
  /** Total masses served in the month (any day); drives Remarks column background. */
  servedInMonth: number;
};

export type GridReportPdfInput = {
  churchName: string;
  churchAddress: string;
  reportTitle: string;
  monthLabel: string;
  generatedAtLabel: string;
  logoDataUrl?: string;
  /** Weekend days with ≥1 secretary session; each session is one column with real mass name. */
  columnGroups: ReportDateGroup[];
  memberRows: GridMemberRow[];
};

type DocWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

const HEADER_FILL: [number, number, number] = [41, 61, 51];
const GREEN: [number, number, number] = [130, 210, 130];
const RED: [number, number, number] = [240, 110, 110];
const WHITE: [number, number, number] = [255, 255, 255];
const TEXT_WHITE: [number, number, number] = [255, 255, 255];

function formatDateHeading(ymd: string): string {
  try {
    return format(parseISO(ymd), "MMMM d, yyyy");
  } catch {
    return ymd;
  }
}

function cellBody(kind: "served" | "absent"): {
  content: string;
  styles: {
    fillColor: [number, number, number];
    halign: "center";
    valign: "middle";
    minCellHeight: number;
  };
} {
  if (kind === "served") {
    return {
      content: "",
      styles: { fillColor: GREEN, halign: "center", valign: "middle", minCellHeight: 12 },
    };
  }
  return {
    content: "",
    styles: { fillColor: RED, halign: "center", valign: "middle", minCellHeight: 12 },
  };
}

function totalDataColumns(groups: ReportDateGroup[]): number {
  let n = 0;
  for (const g of groups) n += g.sessions.length;
  return n;
}

/**
 * One continuous table, full usable page width, no horizontal duplicate tables.
 * Dynamic columns: only weekend Mass sessions the secretary recorded.
 */
export function buildGridAttendancePdf(input: GridReportPdfInput): Uint8Array {
  const groups = input.columnGroups;
  const dataColCount = totalDataColumns(groups);
  const colCount = dataColCount > 0 ? 2 + dataColCount : 2;

  const useA3 = dataColCount > 16;
  const doc = new jsPDF({
    unit: "pt",
    orientation: "landscape",
    format: useA3 ? "a3" : "a4",
  }) as DocWithTable;

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 28;
  const innerW = pageW - margin * 2;
  let y = margin;

  if (input.logoDataUrl) {
    try {
      doc.addImage(input.logoDataUrl, "PNG", margin, y - 2, 36, 36);
    } catch {
      // Fall back silently if logo cannot be decoded.
    }
  }
  const textX = input.logoDataUrl ? margin + 44 : margin;
  doc.setFontSize(16);
  doc.setTextColor(28, 28, 28);
  doc.text(input.churchName, textX, y + (input.logoDataUrl ? 10 : 0));
  y += 22;
  doc.setFontSize(10);
  doc.setTextColor(70, 70, 70);
  if (input.churchAddress) {
    doc.text(input.churchAddress, textX, y + (input.logoDataUrl ? 2 : 0));
    y += 14;
  }
  doc.setFontSize(12);
  doc.setTextColor(28, 28, 28);
  doc.text(input.reportTitle, textX, y + (input.logoDataUrl ? 2 : 0));
  y += 18;
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  doc.text(`Period: ${input.monthLabel}`, margin, y);
  y += 13;
  doc.text(`Generated: ${input.generatedAtLabel}`, margin, y);
  y += 20;
  doc.setTextColor(28, 28, 28);

  const nameColW = Math.max(70, Math.min(118, innerW * 0.13));
  const remarksColW = Math.max(74, Math.min(125, innerW * 0.14));
  const gridW = Math.max(innerW - nameColW - remarksColW, 24);
  const dataColW = dataColCount > 0 ? gridW / dataColCount : 0;

  const fontSize = Math.max(
    4.5,
    Math.min(8.5, Math.floor(480 / Math.max(dataColCount + 3, 8)))
  );

  const head: { content: string; colSpan?: number; rowSpan?: number; styles?: Record<string, unknown> }[][] = [];

  if (dataColCount === 0) {
    head.push([
      {
        content: "Name",
        styles: {
          halign: "center" as const,
          valign: "middle" as const,
          fillColor: HEADER_FILL,
          textColor: TEXT_WHITE,
          fontSize,
        },
      },
      {
        content: "Remarks",
        styles: {
          halign: "center" as const,
          valign: "middle" as const,
          fillColor: HEADER_FILL,
          textColor: TEXT_WHITE,
          fontSize,
        },
      },
    ]);
  } else {
    const row1: typeof head[0] = [
      {
        content: "Name",
        rowSpan: 2,
        styles: {
          halign: "center" as const,
          valign: "middle" as const,
          fillColor: HEADER_FILL,
          textColor: TEXT_WHITE,
        },
      },
    ];
    for (const g of groups) {
      row1.push({
        content: formatDateHeading(g.dateYmd),
        colSpan: Math.max(1, g.sessions.length),
        styles: {
          halign: "center" as const,
          valign: "middle" as const,
          fillColor: HEADER_FILL,
          textColor: TEXT_WHITE,
          fontSize,
        },
      });
    }
    row1.push({
      content: "Remarks",
      rowSpan: 2,
      styles: {
        halign: "center" as const,
        valign: "middle" as const,
        fillColor: HEADER_FILL,
        textColor: TEXT_WHITE,
      },
    });

    const row2: (typeof head)[0] = [];
    for (const g of groups) {
      for (const s of g.sessions) {
        row2.push({
          content: s.massName,
          styles: {
            halign: "center" as const,
            valign: "middle" as const,
            fillColor: HEADER_FILL,
            textColor: TEXT_WHITE,
            fontSize: Math.max(4, fontSize - 0.75),
          },
        });
      }
    }
    head.push(row1, row2);
  }

  const body: unknown[][] = [];
  for (const row of input.memberRows) {
    const line: unknown[] = [
      {
        content: row.fullName,
        styles: {
          fillColor: WHITE,
          halign: "left" as const,
          valign: "middle" as const,
          fontSize,
        },
      },
    ];
    for (const kind of row.cells) {
      line.push(cellBody(kind));
    }
    const noServe = row.servedInMonth <= 0;
    line.push({
      content: row.remarks,
      styles: {
        fillColor: noServe ? RED : WHITE,
        textColor: noServe ? TEXT_WHITE : [28, 28, 28],
        halign: "center" as const,
        valign: "middle" as const,
        fontSize,
      },
    });
    body.push(line);
  }

  if (body.length === 0) {
    body.push([
      {
        content: "No members in directory",
        colSpan: colCount,
        styles: { halign: "center" as const, fillColor: WHITE },
      },
    ]);
  }

  const columnStyles: Record<number, { cellWidth: number }> = {
    0: { cellWidth: nameColW },
    [colCount - 1]: { cellWidth: remarksColW },
  };
  for (let c = 1; c < colCount - 1; c++) {
    columnStyles[c] = { cellWidth: dataColW };
  }

  autoTable(doc, {
    startY: y,
    head: head as never,
    body: body as never,
    theme: "grid",
    tableLineColor: [0, 0, 0],
    tableLineWidth: 0.5,
    styles: {
      fontSize,
      cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 },
      lineColor: [0, 0, 0],
      lineWidth: 0.35,
      valign: "middle",
      halign: "center",
    },
    headStyles: {
      fillColor: HEADER_FILL,
      textColor: TEXT_WHITE,
      fontStyle: "bold",
      fontSize,
    },
    columnStyles,
    margin: { left: margin, right: margin },
    tableWidth: innerW,
    showHead: "everyPage",
  });

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
