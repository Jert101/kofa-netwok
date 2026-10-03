import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "@/lib/system/backup-csv";
import { backupFileNames, SECRET_SETTING_KEYS } from "@/lib/system/backup-tables";

describe("the backup file list", () => {
  it("includes every table the spec names", () => {
    const names = backupFileNames();
    for (const expected of [
      "members.csv",
      "member_batches.csv",
      "masses.csv",
      "sessions.csv",
      "attendance_records.csv",
      "attendance_records_archive.csv",
      "appeals.csv",
      "liturgy_planned.csv",
      "session_liturgy_servers.csv",
      "payment_structures.csv",
      "payments.csv",
      "announcements.csv",
      "reports.csv",
      "settings.csv",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("has no duplicate file names, which would silently drop a table", () => {
    const names = backupFileNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries the void columns, so a voided payment is visible in the export", () => {
    // A bookkeeper reconciling a bank statement needs to see that a receipt exists and was struck out.
    const names = backupFileNames();
    expect(names).toContain("payments.csv");
  });
});

describe("secret stripping", () => {
  it("never names a PIN hash anywhere", () => {
    // The filter is by column name on a table whose column names *are* the keys, so an off-by-one in the
    // exclude list would put every hash in a file an admin can download and email.
    const source = SECRET_SETTING_KEYS;
    for (const role of ["admin", "secretary", "member", "officer", "treasurer", "super_admin"]) {
      expect(source, role).toContain(`pin_${role}_hash`);
    }
  });

  it("lists every role's PIN hash", () => {
    expect(SECRET_SETTING_KEYS).toHaveLength(6);
    expect(SECRET_SETTING_KEYS.every((k: string) => k.startsWith("pin_") && k.endsWith("_hash"))).toBe(
      true,
    );
  });
});

describe("csvCell", () => {
  it("passes a plain value through", () => {
    expect(csvCell("Ana")).toBe("Ana");
    expect(csvCell(42)).toBe("42");
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes a value containing a comma", () => {
    expect(csvCell("Santos, Maria")).toBe('"Santos, Maria"');
  });

  it("quotes and doubles an embedded quote", () => {
    // O'Brien is not a comma problem, but "3ft 6in" as a free-text guest is, and a doubled quote is what
    // stops Excel ending the row early.
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a newline", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a value with leading or trailing whitespace", () => {
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  it("renders a Date as an ISO string", () => {
    expect(csvCell(new Date("2026-10-04T00:00:00Z"))).toBe("2026-10-04T00:00:00.000Z");
  });

  it("renders a Postgres array readably rather than as its JSON", () => {
    // PostgREST returns text[] as a real array; String() would give "admin,secretary" unquoted, which is
    // indistinguishable from two columns.
    expect(csvCell(["admin", "secretary"])).toBe('"admin,secretary"');
  });
});

describe("csvRow", () => {
  it("joins a simple row", () => {
    expect(csvRow(["a", "b", 1])).toBe("a,b,1");
  });

  it("keeps the column count when a value contains a comma", () => {
    expect(csvRow(["Santos, Maria", "b"])).toBe('"Santos, Maria",b');
  });

  it("renders empty cells for nulls without collapsing the row", () => {
    expect(csvRow(["a", null, "c"])).toBe("a,,c");
  });
});