import { format } from "date-fns";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export interface PaymentStatusRow {
  memberName: string;
  totalAmount: number;
  totalPaid: number;
  remaining: number;
  monthlyPaid: number[];
}

export function buildPaymentStructurePdf(input: {
  churchName: string;
  structureName: string;
  deadline: string | null;
  generatedAt: Date;
  installmentMonths: number | null;
  monthLabels: string[];
  rows: PaymentStatusRow[];
}): Uint8Array {
  const hasInstallments = input.installmentMonths != null && input.monthLabels.length > 0;
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: hasInstallments ? "landscape" : "portrait" });
  const margin = hasInstallments ? 24 : 36;
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
  if (hasInstallments) {
    const perMonth = input.rows.length > 0 ? input.rows[0].totalAmount / input.installmentMonths! : 0;
    doc.text(`${input.installmentMonths} months · ₱${input.rows[0]?.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }) ?? "0.00"} total · ₱${perMonth.toLocaleString(undefined, { minimumFractionDigits: 2 })}/month`, margin, y);
    y += 12;
  }

  const paidCount = input.rows.filter((r) => r.remaining <= 0).length;
  const unpaidCount = input.rows.length - paidCount;
  doc.text(`Total members: ${input.rows.length}  |  Paid: ${paidCount}  |  Not paid: ${unpaidCount}`, margin, y);
  y += 14;

  if (hasInstallments) {
    const monthCols = input.monthLabels.map((_, i) => ({
      col: 2 + i,
      width: 36,
    }));

    const headRow = ["#", "Member name", ...input.monthLabels, "Total", "Remaining", "Remarks"];
    const colStyles: Record<string, { cellWidth: number | "auto"; halign?: "left" | "center" | "right"; fontSize?: number }> = {};
    for (const mc of monthCols) {
      colStyles[mc.col] = { cellWidth: mc.width, halign: "center", fontSize: 7 };
    }
    const lastIdx = headRow.length - 1;
    colStyles[0] = { cellWidth: 20, halign: "center" };
    colStyles[1] = { cellWidth: "auto", halign: "left" };
    colStyles[lastIdx - 2] = { cellWidth: 50, halign: "right", fontSize: 8 };
    colStyles[lastIdx - 1] = { cellWidth: 50, halign: "right", fontSize: 8 };
    colStyles[lastIdx] = { cellWidth: 44, halign: "center", fontSize: 8 };

    autoTable(doc, {
      startY: y + 6,
      theme: "grid",
      head: [headRow],
      body: input.rows.map((r, idx) => [
        String(idx + 1),
        r.memberName,
        ...r.monthlyPaid.map((v) =>
          v > 0
            ? v.toLocaleString(undefined, { minimumFractionDigits: 0 })
            : "—"
        ),
        r.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }),
        Math.max(0, r.remaining).toLocaleString(undefined, { minimumFractionDigits: 2 }),
        r.remaining <= 0 ? "Paid" : "Not Paid",
      ]),
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8,
        cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
        lineColor: [0, 0, 0],
        lineWidth: 0.25,
        textColor: [28, 28, 28],
      },
      headStyles: {
        fillColor: [41, 61, 51],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 7,
      },
      columnStyles: colStyles,
    });
  } else {
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
        1: { cellWidth: "auto" as unknown as number },
        2: { cellWidth: 70, halign: "right" },
        3: { cellWidth: 70, halign: "right" },
        4: { cellWidth: 70, halign: "right" },
        5: { cellWidth: 60, halign: "center" },
      },
    });
  }

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setFontSize(10);
  doc.setTextColor(28, 28, 28);
  doc.text("Summary", margin, finalY + 24);
  doc.setFontSize(9);
  const totalDue = input.rows.reduce((s, r) => s + r.totalAmount, 0);
  const totalPaidSum = input.rows.reduce((s, r) => s + r.totalPaid, 0);
  doc.text(`Total amount due: ₱${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin, finalY + 40);
  doc.text(`Total amount paid: ₱${totalPaidSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin, finalY + 54);
  doc.text(`Overall remaining: ₱${(totalDue - totalPaidSum).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, margin, finalY + 68);
  doc.text(`Members fully paid: ${paidCount}`, margin, finalY + 82);
  doc.text(`Members not fully paid: ${unpaidCount}`, margin, finalY + 96);

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
