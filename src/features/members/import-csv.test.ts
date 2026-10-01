import { describe, expect, it } from "vitest";
import {
  checkImportRows,
  errorReportCsv,
  formatImportDate,
  IMPORT_HEADERS,
  importTemplateCsv,
  MAX_IMPORT_ROWS,
  readCsvFile,
  splitCsvLine,
  type ImportRow,
} from "@/features/members/import-csv";

const HEADER = IMPORT_HEADERS.join(",");

function rowsFrom(csv: string): ImportRow[] {
  return readCsvFile(csv).rows;
}

describe("splitCsvLine", () => {
  it("splits plain cells", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a comma inside quotes", () => {
    expect(splitCsvLine('"Catadman, Jerson",male')).toEqual(["Catadman, Jerson", "male"]);
  });

  it("unescapes a doubled quote", () => {
    expect(splitCsvLine('"He said ""hi"""')).toEqual(['He said "hi"']);
  });

  it("returns one cell for a single column", () => {
    expect(splitCsvLine("only")).toEqual(["only"]);
  });
});

describe("readCsvFile", () => {
  it("reads the template's own headers", () => {
    const { rows } = readCsvFile(`${HEADER}\r\nJerson,Catadman,L,1990-05-04,male,0917,2025`);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({
      first_name: "Jerson",
      last_name: "Catadman",
      middle_initial: "L",
      date_of_birth: "1990-05-04",
      gender: "male",
      contact_number: "0917",
      batch: "2025",
    });
    expect(rows[0].line).toBe(2);
  });

  it("accepts the headers in any order and any case", () => {
    const { rows } = readCsvFile(
      "BATCH,last_name,Gender,first_name,CONTACT_NUMBER,DATE_OF_BIRTH,MIDDLE_INITIAL\n2025,Catadman,male,Jerson,0917,1990-05-04,L",
    );
    expect(rows[0].status).toBe("ok");
    expect(rows[0].message).toBeNull();
    expect(rows[0].values.first_name).toBe("Jerson");
    expect(rows[0].values.last_name).toBe("Catadman");
    expect(rows[0].values.batch).toBe("2025");
    expect(rows[0].values.gender).toBe("male");
  });

  it("reports a missing column instead of importing nonsense", () => {
    const { rows } = readCsvFile("first_name,last_name\nJerson,Catadman");
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toContain("date_of_birth");
  });

  it("ignores blank lines", () => {
    expect(rowsFrom(`${HEADER}\r\n\r\nJerson,Catadman,,,,,\r\n`)).toHaveLength(1);
  });

  it("stops at the row limit and says so", () => {
    const many = Array.from(
      { length: MAX_IMPORT_ROWS + 5 },
      (_, i) => `A${i},B${i},,,,,,`,
    ).join("\r\n");
    const { rows, truncated } = readCsvFile(`${HEADER}\r\n${many}`);
    expect(rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(truncated).toBe(true);
  });

  it("keeps the raw text of a row that fails, for the error report", () => {
    const { rows } = readCsvFile(`${HEADER}\r\nJerson,Catadman,x,not-a-date,,,`);
    expect(rows[0].values.middle_initial).toBe("x");
    expect(rows[0].values.date_of_birth).toBe("not-a-date");
  });
});

describe("checkImportRows", () => {
  it("accepts a good row", () => {
    const rows = checkImportRows(
      rowsFrom(`${HEADER}\r\nJerson,Catadman,L,1990-05-04,male,0917,2025`),
      [],
    );
    expect(rows[0].status).toBe("ok");
    expect(rows[0].full_name).toBe("Jerson L. Catadman");
  });

  it("rejects a row with no last name", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,,,,male,,`), []);
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toBeTruthy();
  });

  it("rejects an impossible date", () => {
    const rows = checkImportRows(
      rowsFrom(`${HEADER}\r\nJerson,Catadman,,1990-02-30,,,`),
      [],
    );
    expect(rows[0].status).toBe("error");
  });

  it("rejects a middle initial of more than one letter", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,Luc,,,,`), []);
    expect(rows[0].status).toBe("error");
  });

  it("flags a name already on the roll, and says whose", () => {
    const rows = checkImportRows(
      rowsFrom(`${HEADER}\r\nJerson,Catadman,L,1990-05-04,male,,`),
      [{ id: "m1", fullName: "Jerson L. Catadman" }],
    );
    expect(rows[0].status).toBe("duplicate");
    expect(rows[0].conflictId).toBe("m1");
  });

  it("matches a duplicate when the stored name omits the period after an initial", () => {
    const rows = checkImportRows(
      rowsFrom(`${HEADER}\r\nJerson,Catadman,L,,,,`),
      [{ id: "m1", fullName: "Jerson L Catadman" }],
    );
    expect(rows[0].status).toBe("duplicate");
  });

  it("matches a duplicate written in a different case", () => {
    const rows = checkImportRows(
      rowsFrom(`${HEADER}\r\njerson,catadman,,,,,`),
      [{ id: "m1", fullName: "Jerson Catadman" }],
    );
    expect(rows[0].status).toBe("duplicate");
  });

  it("does not merge two people whose middle initials differ", () => {
    const rows = checkImportRows(
      rowsFrom(`${HEADER}\r\nJerson,Catadman,,,,,`),
      [{ id: "m1", fullName: "Jerson L. Catadman" }],
    );
    expect(rows[0].status).toBe("ok");
  });

  it("catches the same name twice inside one file", () => {
    const rows = checkImportRows(
      rowsFrom(`${HEADER}\r\nJerson,Catadman,,,,,\r\njerson,CATADMAN,,,,,`),
      [],
    );
    expect(rows[0].status).toBe("ok");
    expect(rows[1].status).toBe("duplicate");
    expect(rows[1].message).toContain("line 2");
  });

  it("treats an empty optional cell as not given", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,,,,,`), []);
    expect(rows[0].status).toBe("ok");
  });

  it("leaves a missing-header complaint alone", () => {
    const rows = checkImportRows(readCsvFile("first_name,last_name\nA,B").rows, []);
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toContain("Missing column");
  });
});

describe("formatImportDate", () => {
  it("passes an ISO date straight through", () => {
    expect(formatImportDate("1990-05-04")).toBe("1990-05-04");
  });

  it("reads MM/DD/YYYY", () => {
    expect(formatImportDate("05/04/1990")).toBe("1990-05-04");
  });

  it("reads a single digit month or day", () => {
    expect(formatImportDate("5/4/1990")).toBe("1990-05-04");
  });

  it("is month first, not day first", () => {
    expect(formatImportDate("12/25/1990")).toBe("1990-12-25");
  });

  it("trims surrounding whitespace", () => {
    expect(formatImportDate("  05/04/1990 ")).toBe("1990-05-04");
  });

  it("treats an empty cell as no date", () => {
    expect(formatImportDate("")).toBeNull();
    expect(formatImportDate("   ")).toBeNull();
  });

  // Guessing here would store the wrong birthday, quietly, for years.
  it("refuses a day-first date rather than swapping the parts", () => {
    expect(formatImportDate("13/05/1990")).toBeNull();
    expect(formatImportDate("25/12/1990")).toBeNull();
  });

  it("refuses a shape it does not recognise", () => {
    expect(formatImportDate("1990.05.04")).toBeNull();
    expect(formatImportDate("4 May 1990")).toBeNull();
    expect(formatImportDate("not-a-date")).toBeNull();
  });

  it("refuses a two digit year", () => {
    expect(formatImportDate("05/04/90")).toBeNull();
  });
});

describe("checkImportRows date handling", () => {
  it("accepts MM/DD/YYYY and normalizes it for the database", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,,05/04/1990,,,`), []);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].dateOfBirth).toBe("1990-05-04");
  });

  it("keeps the file's own text for the error report", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,,5/4/90,,,`), []);
    expect(rows[0].values.date_of_birth).toBe("5/4/90");
  });

  it("rejects a shape it cannot read, naming the two it accepts", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,,1990.05.04,,,`), []);
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toContain("YYYY-MM-DD");
    expect(rows[0].message).toContain("MM/DD/YYYY");
  });

  it("still catches a real date that does not exist, in either format", () => {
    const iso = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,,1990-02-30,,,`), []);
    expect(iso[0].status).toBe("error");

    const us = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,,02/30/1990,,,`), []);
    expect(us[0].status).toBe("error");
  });

  it("handles a leap day that is real", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,,02/29/2000,,,`), []);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].dateOfBirth).toBe("2000-02-29");
  });

  it("rejects a leap day in a year that has none", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\nJerson,Catadman,,02/29/1900,,,`), []);
    expect(rows[0].status).toBe("error");
  });
});

describe("template and error report", () => {
  it("downloads exactly the documented headers", () => {
    expect(importTemplateCsv().trim()).toBe(
      "first_name,last_name,middle_initial,date_of_birth,gender,contact_number,batch",
    );
  });

  it("a file of just the template imports no rows", () => {
    expect(readCsvFile(importTemplateCsv()).rows).toHaveLength(0);
  });

  it("reports only the rows that failed, with the reason", () => {
    const rows = checkImportRows(
      rowsFrom(`${HEADER}\r\nJerson,Catadman,,,male,,\r\nBad,,,,male,,`),
      [],
    );
    const report = errorReportCsv(rows);
    const lines = report.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("reason");
    expect(lines[1]).toContain("Bad");
    // The row that imported cleanly is not in the report.
    expect(report).not.toContain("Catadman");
  });

  it("quotes a cell containing a comma in the report", () => {
    const rows = checkImportRows(rowsFrom(`${HEADER}\r\n"Smith, Jr",Roe,,not-a-date,,,`), []);
    expect(rows[0].status).toBe("error");
    expect(errorReportCsv(rows)).toContain('"Smith, Jr"');
  });
});
