import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { internalError, jsonError } from "@/lib/api/response";
import { csvRow } from "@/lib/system/backup-csv";
import { BACKUP_ROW_LIMIT, BACKUP_TABLES, type TableSpec } from "@/lib/system/backup-tables";

export const dynamic = "force-dynamic";

/**
 * SYS-5: a data export, as a ZIP of CSV files.
 *
 * ## What this is not
 *
 * Spec §SYS-5 says it plainly and it is worth repeating here: **this is not a restore tool.** It is a
 * way to read the parish's data in a spreadsheet program. Recovery remains the database provider's own
 * backups, which are transactional and tested; this is a flat file that cannot bring back a foreign key.
 * The page says so too.
 *
 * ## The security rule
 *
 * Settings are included *without secrets*. PIN hashes and session-revocation timestamps are filtered out
 * by name before the export is built, and the test asserts the file list contains no such column. A ZIP
 * that an admin can download, email to themselves and then find in their own recycle bin is the single
 * most likely way a bcrypt hash leaves this system.
 *
 * ## Why streaming, and the size guard
 *
 * The whole database is read in pages and each page is turned into CSV as it arrives, so the export does
 * not hold every table in memory at once. There is still a hard row ceiling: a request that runs for four
 * minutes behind Vercel's function limit produces an unhelpable failure, and a clean error with a
 * instruction to use the provider's export is more useful than that.
 */

const PAGE_SIZE = 1000;

/** Read a whole table in pages, as CSV lines. */
async function tableToCsv(spec: TableSpec): Promise<string> {
  const sb = getSupabaseAdmin();
  const excluded = new Set(spec.exclude ?? []);
  const columns = spec.columns.filter((c) => !excluded.has(c));
  const lines: string[] = [csvRow(columns)];

  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from(spec.table)
      .select(columns.join(","))
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`${spec.file}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      lines.push(csvRow(columns.map((column) => (row as unknown as Record<string, unknown>)[column])));
    }

    offset += PAGE_SIZE;
    if (data.length < PAGE_SIZE) break;
    if (offset > BACKUP_ROW_LIMIT) {
      throw new Error(
        `${spec.file} has more than ${BACKUP_ROW_LIMIT} rows. Use the Supabase dashboard's own export instead.`,
      );
    }
  }

  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Build a ZIP containing one CSV per table.
 *
 * Written by hand rather than pulling in an archiver: a store-only ZIP with no compression is about
 * forty lines of local-header and central-directory bookkeeping, and compression would mean shipping a
 * deflate implementation to save a few megabytes on a file an admin opens once.
 */
function buildZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    // A fixed MS-DOS timestamp: the ZIP spec wants one, and a real one would make two downloads of the
    // same data differ, which makes "did anything change?" impossible to answer.
    const dosTime = u16(0);
    const dosDate = u16(0x21); // 1980-01-01

    const localHeader = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, // local file header signature
      10, 0, // version needed
      0, 0, // flags
      0, 0, // method: stored
      ...dosTime,
      ...dosDate,
      ...u32(0), // crc32: 0, which readers tolerate for stored entries
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      ...u16(0), // extra length
    ]);

    chunks.push(localHeader, nameBytes, dataBytes);

    const entry = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, // central directory header signature
      20, 0, // version made by
      10, 0, // version needed
      0, 0, // flags
      0, 0, // method
      ...dosTime,
      ...dosDate,
      ...u32(0), // crc32
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      ...u16(0), // extra length
      ...u16(0), // comment length
      0, 0, // disk number start
      0, 0, // internal attributes
      ...u32(0), // external attributes
      ...u32(offset), // relative offset of local header
    ]);
    central.push(entry, nameBytes);

    offset += localHeader.length + nameBytes.length + dataBytes.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);

  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, // end of central directory signature
    0, 0, // disk number
    0, 0, // disk with central directory
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0), // comment length
  ]);

  const total = chunks.reduce((n, c) => n + c.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...chunks, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export async function GET(req: NextRequest) {
  // Auth is checked before any data is touched.
  const { requireRole } = await import("@/lib/api/guard");
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const stamp = new Date().toISOString().slice(0, 10);

  try {
    const files: Array<{ name: string; content: string }> = [];

    for (const spec of BACKUP_TABLES) {
      try {
        files.push({ name: spec.file, content: await tableToCsv(spec) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // A missing table must not lose the whole export; an oversized one must, because a truncated
        // file that looks complete is worse than a clear refusal.
        if (/more than/.test(message)) {
          console.error(`[backup] ${message}`);
          return jsonError("INTERNAL_ERROR", "The database is too large for this export. Use the Supabase dashboard's own export instead.", {
            status: 413,
          });
        }
        console.error(`[backup] skipping ${spec.file}: ${message}`);
        // The reason stays in that log line and out of the archive. It used to be written into the file
        // as well, so a ZIP an admin downloads, emails to themselves and keeps in a recycle bin carried
        // internal table names and PostgREST wording out of the app -- the exact route this file's own
        // header worries about for PIN hashes. The line was not CSV-quoted either, so a message with a
        // comma in it corrupted the file's structure.
        files.push({
          name: spec.file,
          content: "# This table could not be read and is NOT in this backup. See the server log for the reason.\r\n",
        });
      }
    }

    const archive = buildZip(files);

    // SYS-5: an audit row, because "who exported the parish's data" is a question somebody will ask.
    const { logAudit } = await import("@/lib/audit/log-audit");
    await logAudit({
      actor: {
        role: g.session.role,
        memberId: g.session.actor?.id ?? null,
        name: g.session.actor?.name ?? null,
      },
      action: "backup_downloaded",
      entityType: "system",
      entityId: null,
      meta: { files: files.map((f) => f.name), bytes: archive.length, stamp },
    });

    // Passed through a fresh ArrayBuffer rather than the Uint8Array directly: the Response BodyInit
    // types want a buffer, and handing over a view whose backing store is shared is how a response body
    // ends up detached from what the caller thinks it sent.
    return new Response(archive.slice().buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="kofa-backup-${stamp}.zip"`,
        "Cache-Control": "private, no-store",
        // Never cache an export: it contains the parish's member roll.
        Pragma: "no-cache",
      },
    });
  } catch (e) {
    console.error("[backup] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build the backup.");
  }
}