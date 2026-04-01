import { format } from "date-fns";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export function buildActiveMembersPdf(input: {
  churchName: string;
  title: string;
  generatedAt: Date;
  names: string[];
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
  doc.text(`Total active members: ${input.names.length}`, margin, y);
  y += 14;

  autoTable(doc, {
    startY: y + 6,
    theme: "grid",
    head: [["#", "Full name"]],
    body:
      input.names.length > 0
        ? input.names.map((name, idx) => [String(idx + 1), name])
        : [["", "No active members"]],
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
    },
  });

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
