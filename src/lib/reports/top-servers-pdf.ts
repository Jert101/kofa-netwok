import { format } from "date-fns";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export type TopServerRow = {
  rank: number;
  full_name: string;
  total_served: number;
};

export function buildTopServersPdf(input: {
  churchName: string;
  title: string;
  generatedAt: Date;
  rows: TopServerRow[];
}): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const margin = 36;
  let y = margin;

  doc.setFontSize(16);
  doc.setTextColor(28, 28, 28);
  doc.text(input.churchName || "Church", margin, y);
  y += 20;

  doc.setFontSize(12);
  doc.text(input.title, margin, y);
  y += 16;

  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  doc.text(`Generated: ${format(input.generatedAt, "PPpp")}`, margin, y);
  y += 14;
  doc.text(`Total members listed: ${input.rows.length}`, margin, y);
  y += 14;

  autoTable(doc, {
    startY: y + 6,
    theme: "grid",
    head: [["#", "Full name", "Masses served"]],
    body:
      input.rows.length > 0
        ? input.rows.map((r) => [
            String(r.rank),
            r.full_name,
            String(r.total_served),
          ])
        : [["", "No data available", ""]],
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 10,
      cellPadding: { top: 4, right: 4, bottom: 4, left: 4 },
      lineColor: [0, 0, 0],
      lineWidth: 0.25,
      textColor: [28, 28, 28],
    },
    headStyles: {
      fillColor: [170, 31, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 36, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 80, halign: "center" },
    },
  });

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
