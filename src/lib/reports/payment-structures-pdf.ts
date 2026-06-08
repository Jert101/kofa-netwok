import { format } from "date-fns";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export interface PaymentStatusRow {
  memberName: string;
  totalAmount: number;
  totalPaid: number;
  remaining: number;
}

export function buildPaymentStructurePdf(input: {
  churchName: string;
  structureName: string;
  deadline: string | null;
  generatedAt: Date;
  rows: PaymentStatusRow[];
}): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const margin = 36;
  let y = margin;

  doc.setFontSize(16);
  doc.setTextColor(28, 28, 28);
  doc.text(input.churchName || "Church", margin, y);
  y += 20;

  doc.setFontSize(14);
  doc.text(input.structureName, margin, y);
  y += 16;

  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  doc.text(`Generated: ${format(input.generatedAt, "PPpp")}`, margin, y);
  y += 12;
  if (input.deadline) {
    doc.text(`Deadline: ${input.deadline}`, margin, y);
    y += 12;
  }

  const paidCount = input.rows.filter((r) => r.remaining <= 0).length;
  const unpaidCount = input.rows.length - paidCount;
  doc.text(`Total members: ${input.rows.length}  |  Paid: ${paidCount}  |  Not paid: ${unpaidCount}`, margin, y);
  y += 14;

  autoTable(doc, {
    startY: y + 6,
    theme: "grid",
    head: [["#", "Member name", "Total amount", "Total paid", "Remaining", "Remarks"]],
    body:
      input.rows.length > 0
        ? input.rows.map((r, idx) => [
            String(idx + 1),
            r.memberName,
            r.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }),
            r.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 }),
            r.remaining.toLocaleString(undefined, { minimumFractionDigits: 2 }),
            r.remaining <= 0 ? "Paid" : "Not Paid",
          ])
        : [["", "No members", "", "", "", ""]],
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 9,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      lineColor: [0, 0, 0],
      lineWidth: 0.25,
      textColor: [28, 28, 28],
    },
    headStyles: {
      fillColor: [41, 61, 51],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 28, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 70, halign: "right" },
      3: { cellWidth: 70, halign: "right" },
      4: { cellWidth: 70, halign: "right" },
      5: { cellWidth: 60, halign: "center" },
    },
    didDrawPage: () => {
      doc.setFontSize(9);
      doc.setTextColor(85, 85, 85);
    },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setFontSize(10);
  doc.setTextColor(28, 28, 28);
  doc.text("Summary", margin, finalY + 24);
  doc.setFontSize(9);
  doc.text(`Total amount due: ₱${input.rows.reduce((s, r) => s + r.totalAmount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin, finalY + 40);
  doc.text(`Total amount paid: ₱${input.rows.reduce((s, r) => s + r.totalPaid, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin, finalY + 54);
  doc.text(`Overall remaining: ₱${input.rows.reduce((s, r) => s + r.remaining, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin, finalY + 68);
  doc.text(`Members fully paid: ${paidCount}`, margin, finalY + 82);
  doc.text(`Members not fully paid: ${unpaidCount}`, margin, finalY + 96);

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
