import { format } from "date-fns";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export type RegistrationRequestRow = {
  index: number;
  name: string;
  gender: string;
  date_of_birth: string;
  contact_number: string;
  batch: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
};

export function buildRegistrationRequestsPdf(input: {
  churchName: string;
  title: string;
  generatedAt: Date;
  rows: RegistrationRequestRow[];
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
  doc.text(`Total requests: ${input.rows.length}`, margin, y);
  y += 14;

  autoTable(doc, {
    startY: y + 6,
    theme: "grid",
    head: [["#", "Name", "Gender", "Date of birth", "Contact", "Batch", "Status", "Submitted", "Reviewed"]],
    body:
      input.rows.length > 0
        ? input.rows.map((r) => [
            String(r.index),
            r.name,
            r.gender,
            r.date_of_birth,
            r.contact_number,
            r.batch ?? "",
            r.status,
            r.created_at,
            r.reviewed_at ?? "",
          ])
        : [["", "No registration requests", "", "", "", "", "", "", ""]],
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
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
      0: { cellWidth: 28, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 50, halign: "center" },
      3: { cellWidth: 65, halign: "center" },
      4: { cellWidth: 80 },
      5: { cellWidth: 40, halign: "center" },
      6: { cellWidth: 55, halign: "center" },
      7: { cellWidth: 90 },
      8: { cellWidth: 90 },
    },
  });

  return doc.output("arraybuffer") as unknown as Uint8Array;
}
