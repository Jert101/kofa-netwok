import { format } from "date-fns";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export type MemberRow = {
  name: string;
  date_of_birth: string | null;
  gender: string | null;
  batch: string | null;
  contact_number: string | null;
};

function formatDob(dob: string | null): string {
  if (!dob) return "—";
  try {
    return format(new Date(dob + "T12:00:00"), "MMM d, yyyy");
  } catch {
    return dob;
  }
}

export function buildActiveMembersPdf(input: {
  churchName: string;
  title: string;
  label: string;
  generatedAt: Date;
  rows: MemberRow[];
}): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
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
  doc.text(input.label, margin, y);
  y += 14;

  autoTable(doc, {
    startY: y + 6,
    theme: "grid",
    head: [["#", "Full name", "Date of Birth", "Gender", "Batch", "Contact Number"]],
    body:
      input.rows.length > 0
        ? input.rows.map((row, idx) => [
            String(idx + 1),
            row.name,
            formatDob(row.date_of_birth),
            row.gender ?? "—",
            row.batch ?? "—",
            row.contact_number ?? "—",
          ])
        : [["", "No active members", "", "", "", ""]],
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 9,
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
      0: { cellWidth: 30, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 90 },
      3: { cellWidth: 60 },
      4: { cellWidth: 55 },
      5: { cellWidth: 110 },
    },
  });

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
