import { describe, it, expect } from "vitest";
import {
  buildExportTable,
  toCsv,
  exportFileStem,
  columnLabel,
} from "./export";
import type { ReportGridSnapshot } from "./weekend-grid";

const grid: ReportGridSnapshot = {
  columns: [
    { date: "2026-05-03", massName: "First Mass Servers", sessionId: "s1" },
    { date: "2026-05-03", massName: "Second Mass Servers", sessionId: "s2" },
    { date: "2026-05-10", massName: "First Mass Servers", sessionId: "s3" },
  ],
  rows: [
    {
      memberId: "m1",
      name: "Dela Cruz, Juan",
      cells: ["S", "A", "S"],
      served: 2,
      servedInMonth: 3,
      remarks: "Served 2 masses",
    },
    {
      memberId: "m2",
      name: "O'Brien, Ana",
      cells: ["A", "A", "A"],
      served: 0,
      servedInMonth: 0,
      remarks: "Didn't serve",
    },
    {
      memberId: "m3",
      name: 'He said "yes", then left',
      cells: ["S", "S", "S"],
      served: 3,
      servedInMonth: 3,
      remarks: "Served 3 masses",
    },
  ],
};

describe("columnLabel", () => {
  it("combines date and Mass so a two-Mass day stays distinguishable", () => {
    expect(columnLabel(grid.columns[0])).toBe("2026-05-03 · First Mass Servers");
    expect(columnLabel(grid.columns[1])).toBe("2026-05-03 · Second Mass Servers");
  });
});

describe("buildExportTable", () => {
  it("puts the name first, one column per grid column, then totals and remarks", () => {
    const t = buildExportTable(grid);
    expect(t.header).toEqual([
      "Full name",
      "2026-05-03 · First Mass Servers",
      "2026-05-03 · Second Mass Servers",
      "2026-05-10 · First Mass Servers",
      "Masses served",
      "Remarks",
    ]);
    expect(t.rows[0]).toHaveLength(t.header.length);
    expect(t.rows.every((r) => r.length === t.header.length)).toBe(true);
  });

  it("spells out the marks rather than exporting bare S and A", () => {
    const t = buildExportTable(grid);
    expect(t.rows[0].slice(1, 4)).toEqual(["Served", "Absent", "Served"]);
    expect(t.rows[1].slice(1, 4)).toEqual(["Absent", "Absent", "Absent"]);
  });

  it("carries the served count and remarks through unchanged", () => {
    const t = buildExportTable(grid);
    expect(t.rows[0].slice(4)).toEqual(["2", "Served 2 masses"]);
    expect(t.rows[1].slice(4)).toEqual(["0", "Didn't serve"]);
  });

  it("preserves snapshot row order rather than re-sorting", () => {
    expect(buildExportTable(grid).rows.map((r) => r[0])).toEqual([
      "Dela Cruz, Juan",
      "O'Brien, Ana",
      'He said "yes", then left',
    ]);
  });

  it("bounds a row whose stored cells are longer than the header", () => {
    // Corrupt or hand-edited snapshot. The header is the source of truth for width, so the
    // row is truncated rather than producing a ragged CSV.
    const t = buildExportTable({ columns: [], rows: grid.rows });
    expect(t.rows.every((r) => r.length === t.header.length)).toBe(true);
    expect(t.rows[0]).toEqual(["Dela Cruz, Juan", "2", "Served 2 masses"]);
  });

  it("pads a row whose stored cells are shorter than the header", () => {
    const t = buildExportTable({
      columns: grid.columns,
      rows: [{ ...grid.rows[0], cells: ["S"] }],
    });
    const row = t.rows[0];
    expect(row.length).toBe(t.header.length);
    expect(row.slice(1, 4)).toEqual(["Served", "Absent", "Absent"]);
    // The served count still lands in the right column.
    expect(row.slice(4)).toEqual(["2", "Served 2 masses"]);
  });

  it("produces a header and no rows for an empty report", () => {
    const t = buildExportTable({ columns: [], rows: [] });
    expect(t.header).toHaveLength(3);
    expect(t.rows).toEqual([]);
  });
});

describe("toCsv", () => {
  it("quotes a field containing a comma and doubles inner quotes", () => {
    const csv = toCsv(buildExportTable(grid));
    const lines = csv.split("\r\n");
    // O'Brien, Ana has a comma, so the whole field is quoted.
    expect(lines[2]).toContain("\"O'Brien, Ana\"");
    // The doubly-quoted name must survive verbatim inside quotes.
    expect(lines[3]).toContain('"He said ""yes"", then left"');
  });

  it("does not quote fields that need no quoting", () => {
    const csv = toCsv(buildExportTable(grid));
    const lines = csv.split("\r\n");
    expect(lines[0].startsWith("Full name,2026-05-03 · First Mass Servers")).toBe(true);
    expect(lines[1]).toContain("Served 2 masses");
  });

  it("ends with CRLF so Excel does not treat the last line as unterminated", () => {
    expect(toCsv(buildExportTable(grid)).endsWith("\r\n")).toBe(true);
  });

  it("emits a header row even with no members", () => {
    const csv = toCsv(buildExportTable({ columns: [], rows: [] }));
    expect(csv).toBe("Full name,Masses served,Remarks\r\n");
  });

  it("keeps the column count identical on every line", () => {
    const csv = toCsv(buildExportTable(grid));
    // Count separators outside quotes only.
    const countFields = (line: string) => {
      let fields = 1;
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') i++;
          else inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) fields++;
      }
      return fields;
    };
    const lines = csv.trimEnd().split("\r\n");
    expect(lines.map(countFields)).toEqual(lines.map(() => 6));
  });
});

describe("exportFileStem", () => {
  it("keeps words and dashes and turns spaces into dashes", () => {
    expect(exportFileStem("Attendance Report — May 2026", "csv")).toBe(
      "Attendance-Report-May-2026.csv",
    );
  });

  it("strips characters that would break a Content-Disposition header", () => {
    // Punctuation removal leaves "rm -rf" as "rm--rf"; runs are collapsed.
    expect(exportFileStem('re"port/2026; rm -rf', "xlsx")).toBe("report2026-rm-rf.xlsx");
  });

  it("falls back when the title is entirely unusable", () => {
    expect(exportFileStem("///", "csv")).toBe("attendance-report.csv");
  });

  it("caps an absurdly long title", () => {
    const stem = exportFileStem("a".repeat(500), "csv");
    expect(stem.length).toBeLessThanOrEqual(80 + ".csv".length);
    expect(stem.endsWith(".csv")).toBe(true);
  });

  it("does not leave a trailing dash after truncation", () => {
    const stem = exportFileStem(`${"a".repeat(79)} b`, "csv");
    expect(stem.endsWith(".csv")).toBe(true);
  });
});
