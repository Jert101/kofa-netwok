/**
 * Server side of the member CSV import (module 03, MEM-5).
 *
 * The browser already drew a preview, but the preview is not trusted: the same
 * rows are parsed, validated and duplicate-checked again here before anything is
 * written. That is the only place the "what will happen" view and the "what did
 * happen" outcome can be kept honest.
 *
 * The insert itself is a single Postgres function so it is one transaction. A
 * failure part-way through cannot leave half a file on the roll.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  checkImportRows,
  MAX_IMPORT_ROWS,
  readCsvFile,
  type ExistingName,
  type ImportRow,
} from "@/features/members/import-csv";

export type ImportPreview = {
  rows: ImportRow[];
  truncated: boolean;
  counts: { ok: number; duplicate: number; error: number };
  /** Batch years named in the file that the roll does not have yet. */
  unknownBatches: string[];
};

function countByStatus(rows: readonly ImportRow[]) {
  let ok = 0;
  let duplicate = 0;
  let error = 0;
  for (const row of rows) {
    if (row.status === "ok") ok += 1;
    else if (row.status === "duplicate") duplicate += 1;
    else error += 1;
  }
  return { ok, duplicate, error };
}

/**
 * Every active member, reduced to what a duplicate check needs.
 *
 * Deliberately not paginated: the import needs to know whether a name is already
 * on the roll, and a name past the first page is just as taken as one on it.
 *
 * A parish large enough to hit PostgREST's row cap is the limit of this. The cap
 * only affects how many duplicates the *preview* can name; the write path is
 * unaffected because kofa_import_members does its own duplicate check in SQL,
 * where nothing truncates it, and members_unique_active_name is the backstop.
 */
async function loadActiveNames(): Promise<ExistingName[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("members")
    .select("id, full_name")
    .eq("is_active", true)
    .limit(100_000);

  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({ id: m.id as string, fullName: m.full_name as string }));
}

async function loadBatchYears(): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("member_batches")
    .select("year")
    .order("year", { ascending: false })
    .limit(1000);

  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => String(b.year));
}

export async function previewImport(csv: string): Promise<ImportPreview> {
  const [existing, knownBatches] = await Promise.all([loadActiveNames(), loadBatchYears()]);
  const { rows, truncated } = readCsvFile(csv);
  const checked = checkImportRows(rows, existing);

  const named = new Set(
    checked.map((r) => r.values.batch).filter((b) => b.length > 0),
  );
  const unknownBatches = [...named].filter((b) => !knownBatches.includes(b)).sort();

  return { rows: checked, truncated, counts: countByStatus(checked), unknownBatches };
}

export type ImportResult = {
  counts: { imported: number; duplicate: number; invalid: number };
  /** The rows that did not land, with the reason, ready for the error download. */
  failed: ImportRow[];
};

// `row_position`, not `position`: POSITION is a reserved SQL word, so the function
// cannot return a column by that name unquoted.
type RpcRow = {
  row_position: number;
  full_name: string;
  member_id: string | null;
  status: string;
};

export async function commitImport(
  csv: string,
  options: { createMissingBatches: boolean },
): Promise<ImportResult> {
  const preview = await previewImport(csv);

  // Nothing to do is not an error, but it is worth saying so rather than calling
  // the function for no reason.
  if (preview.counts.ok === 0) {
    return {
      counts: {
        imported: 0,
        duplicate: preview.counts.duplicate,
        invalid: preview.counts.error,
      },
      failed: preview.rows.filter((r) => r.status !== "ok"),
    };
  }

  const payload = preview.rows
    .filter((r) => r.status === "ok")
    .slice(0, MAX_IMPORT_ROWS)
    .map((r) => ({
      full_name: r.full_name,
      // The normalized date, not the text from the file: a row written as
      // 05/04/1990 has to reach Postgres as 1990-05-04.
      date_of_birth: r.dateOfBirth,
      gender: r.values.gender || null,
      contact_number: r.values.contact_number || null,
      batch: r.values.batch || null,
    }));

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("kofa_import_members", {
    p_rows: payload,
    p_create_missing_batches: options.createMissingBatches,
  });

  if (error) throw new Error(error.message);

  const results = (data ?? []) as RpcRow[];

  // The function echoes the position within the array it was given, and that array
  // holds only the rows that passed every check, so map it back onto file lines.
  const importable = preview.rows.filter((r) => r.status === "ok");
  const statusByLine = new Map<number, string>();
  for (const r of results) {
    const source = importable[r.row_position];
    if (source) statusByLine.set(source.line, r.status);
  }

  const failed: ImportRow[] = [];
  let imported = 0;
  let duplicate = 0;
  let invalid = 0;

  for (const row of preview.rows) {
    if (row.status !== "ok") {
      if (row.status === "duplicate") duplicate += 1;
      else invalid += 1;
      failed.push(row);
      continue;
    }
    const outcome = statusByLine.get(row.line);
    if (outcome === "imported") imported += 1;
    else {
      // The row passed every check above but the database still refused it, which
      // means someone else inserted that name in between. Report it as a duplicate
      // rather than telling the admin it imported.
      duplicate += 1;
      failed.push({
        ...row,
        status: "duplicate",
        message: "That name was taken while the import was running.",
      });
    }
  }

  return { counts: { imported, duplicate, invalid }, failed };
}
