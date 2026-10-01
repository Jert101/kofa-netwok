/**
 * Parsing and per-row checking for the member CSV import (module 03, MEM-5).
 *
 * The browser runs this to draw the preview and the server runs it again before
 * anything is written. That is deliberate: the preview is a convenience, not a
 * guarantee, so both sides must be able to reach the same verdict on the same row
 * without the server trusting what the browser said.
 *
 * Client-safe. No database access, so the upload step can import it.
 */

import { createMemberSchema } from "@/features/members/member-input";
import { composeFullName, normalizeName } from "@/lib/members/normalize-name";

/** The template the admin downloads, and the only headers accepted. */
export const IMPORT_HEADERS = [
  "first_name",
  "last_name",
  "middle_initial",
  "date_of_birth",
  "gender",
  "contact_number",
  "batch",
] as const;

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 1024 * 1024;

export type ImportRowStatus = "ok" | "error" | "duplicate";

export type ImportRow = {
  /** 1-based line in the file, for the error report. */
  line: number;
  values: {
    first_name: string;
    last_name: string;
    middle_initial: string;
    date_of_birth: string;
    gender: string;
    contact_number: string;
    batch: string;
  };
  full_name: string;
  status: ImportRowStatus;
  /** Why it failed, or which name it duplicates. */
  message: string | null;
  /** The member it collides with, when the collision is with someone already active. */
  conflictId: string | null;
  /**
   * The date of birth normalized to `YYYY-MM-DD`, ready for the database.
   *
   * Kept apart from `values.date_of_birth` on purpose: the error report has to
   * echo back what was actually in the file, otherwise fixing a rejected row means
   * remembering which format the admin started with.
   */
  dateOfBirth: string | null;
};

export type ParsedFile = {
  rows: ImportRow[];
  /** True when the file was cut short at the row limit. */
  truncated: boolean;
};

/** A blank cell, an empty string, a stray quote: all the same thing here. */
function clean(value: string | undefined): string {
  return (value ?? "").replace(/^﻿/, "").trim();
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Accepts the two date shapes a parish spreadsheet actually arrives in.
 *
 * The spec allows `YYYY-MM-DD` and `MM/DD/YYYY`, and calls everything else a row
 * error. `MM/DD/YYYY` is US order, not the local one, and guessing is worse than
 * refusing: 05/04/1990 is one person in one parish and another person in another,
 * and a birthday quietly stored as the wrong date is the kind of mistake nobody
 * notices for years. So a day over 12 is read as a day, and 13/05/1990 is rejected
 * rather than rescued.
 *
 * Only the shape is checked here. Whether the date is real is left to the shared
 * schema, so 02/30/1990 fails the same way it would have failed from the web form
 * instead of passing here and being caught somewhere else.
 *
 * Returns null when the cell cannot be read as either shape.
 */
export function formatImportDate(raw: string): string | null {
  const value = clean(raw);
  if (!value) return null;

  const iso = ISO_DATE.exec(value);
  if (iso) return value;

  const us = US_DATE.exec(value);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = us[3];
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Splits one CSV line.
 *
 * Written by hand because the export quotes every cell, so a name containing a
 * comma or a quote arrives wrapped and doubled. A real parser would also handle
 * newlines inside quotes; the template does not produce those.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/** Splits a whole file, dropping a trailing newline. Blank lines are skipped. */
export function splitCsvRows(text: string): string[] {
  return text
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0);
}

export function readCsvFile(text: string): ParsedFile {
  const lines = splitCsvRows(text);
  if (lines.length === 0) {
    return { rows: [], truncated: false };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const missing = IMPORT_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    return {
      rows: [
        {
          line: 1,
          values: emptyValues(),
          full_name: "",
          status: "error",
          message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
          conflictId: null,
          dateOfBirth: null,
        },
      ],
      truncated: false,
    };
  }

  const index = new Map(header.map((h, i) => [h, i]));
  const dataLines = lines.slice(1);
  const truncated = dataLines.length > MAX_IMPORT_ROWS;
  const rows: ImportRow[] = [];

  dataLines.slice(0, MAX_IMPORT_ROWS).forEach((line, i) => {
    const cells = splitCsvLine(line);
    const pick = (name: string) => clean(cells[index.get(name) ?? -1]);
    rows.push({
      line: i + 2, // +1 for the header, +1 because lines are 1-based
      values: {
        first_name: pick("first_name"),
        last_name: pick("last_name"),
        middle_initial: pick("middle_initial"),
        date_of_birth: pick("date_of_birth"),
        gender: pick("gender").toLowerCase(),
        contact_number: pick("contact_number"),
        batch: pick("batch"),
      },
      full_name: "",
      status: "ok",
      message: null,
      conflictId: null,
      dateOfBirth: null,
    });
  });

  return { rows, truncated };
}

function emptyValues(): ImportRow["values"] {
  return {
    first_name: "",
    last_name: "",
    middle_initial: "",
    date_of_birth: "",
    gender: "",
    contact_number: "",
    batch: "",
  };
}

export type ExistingName = { id: string; fullName: string };

/**
 * Decides the status of every row.
 *
 * `existing` is the active roll, already reduced to name and id. Duplicates are
 * matched on the normalized name, exactly as the approval path does, and also
 * against the other rows in the same file, so a file that lists someone twice is
 * caught in the preview rather than half-imported.
 */
export function checkImportRows(
  rows: ImportRow[],
  existing: readonly ExistingName[],
): ImportRow[] {
  const existingByName = new Map<string, ExistingName>();
  for (const member of existing) {
    const key = normalizeName(member.fullName);
    if (key) existingByName.set(key, member);
  }

  const seenInFile = new Map<string, number>();
  const out: ImportRow[] = [];

  for (const row of rows) {
    // A header complaint is already final.
    if (row.status === "error" && row.line === 1) {
      out.push(row);
      continue;
    }

    const values = { ...row.values, middle_initial: row.values.middle_initial || null } as Record<
      string,
      unknown
    >;

    // A date the file wrote its own way is normalized before the schema sees it, so
    // the rest of the checking only ever deals with `YYYY-MM-DD`. An unreadable one
    // stops here with a message naming the two accepted formats, which is more use
    // than the schema's own complaint would be.
    const rawDate = row.values.date_of_birth;
    const dateOfBirth = formatImportDate(rawDate);
    if (rawDate !== "" && dateOfBirth === null) {
      out.push({
        ...row,
        full_name: composeFullName({
          firstName: row.values.first_name,
          middleInitial: row.values.middle_initial,
          lastName: row.values.last_name,
        }),
        status: "error",
        message: `Use YYYY-MM-DD or MM/DD/YYYY, not "${rawDate}".`,
        conflictId: null,
        dateOfBirth: null,
      });
      continue;
    }

    const parsed = createMemberSchema.safeParse({
      ...values,
      middle_initial: values.middle_initial,
      date_of_birth: dateOfBirth,
      gender: values.gender === "" ? null : values.gender,
      contact_number: values.contact_number === "" ? null : values.contact_number,
      batch: values.batch === "" ? null : values.batch,
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      out.push({
        ...row,
        full_name: composeFullName({
          firstName: row.values.first_name,
          middleInitial: row.values.middle_initial,
          lastName: row.values.last_name,
        }),
        status: "error",
        message: issue?.message ?? "Check this row.",
        conflictId: null,
        dateOfBirth: null,
      });
      continue;
    }

    const fullName = composeFullName({
      firstName: parsed.data.first_name,
      middleInitial: parsed.data.middle_initial,
      lastName: parsed.data.last_name,
    });
    const key = normalizeName(fullName);

    const clash = key ? existingByName.get(key) : undefined;
    if (clash) {
      out.push({
        ...row,
        full_name: fullName,
        status: "duplicate",
        message: `Already an active member: ${clash.fullName}`,
        conflictId: clash.id,
        dateOfBirth,
      });
      continue;
    }

    const firstSeen = key ? seenInFile.get(key) : undefined;
    if (firstSeen !== undefined) {
      out.push({
        ...row,
        full_name: fullName,
        status: "duplicate",
        message: `Same name as line ${firstSeen} of this file.`,
        conflictId: null,
        dateOfBirth,
      });
      continue;
    }
    if (key) seenInFile.set(key, row.line);

    out.push({
      ...row,
      full_name: fullName,
      status: "ok",
      message: null,
      conflictId: null,
      dateOfBirth,
    });
  }

  return out;
}

/** The template itself, so the browser download and the docs cannot drift. */
export function importTemplateCsv(): string {
  return `${IMPORT_HEADERS.join(",")}\r\n`;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** The rows that could not be imported, in the same shape as the template. */
export function errorReportCsv(rows: readonly ImportRow[]): string {
  const bad = rows.filter((r) => r.status !== "ok");
  const lines = [`${IMPORT_HEADERS.join(",")},line,reason`];
  for (const row of bad) {
    lines.push(
      [
        row.values.first_name,
        row.values.last_name,
        row.values.middle_initial,
        row.values.date_of_birth,
        row.values.gender,
        row.values.contact_number,
        row.values.batch,
        String(row.line),
        row.message ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
