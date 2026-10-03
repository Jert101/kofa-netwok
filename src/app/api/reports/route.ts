import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { toReportRowView, type PastReportRow } from "@/lib/reports/hub";

export const runtime = "nodejs";

/**
 * Past reports for the hub (RPT-1).
 *
 * `summary_json` is deliberately not selected. It now carries the full v5 grid, so pulling it
 * for every report means shipping every member's attendance for every month just to render a
 * list of titles and badges. Measured against production: the six existing reports are 126 KB
 * of payload this way versus 1.3 KB without it, and the gap widens by roughly 20 KB per month
 * forever.
 *
 * The one thing needed from the summary is the `data_archived` flag, which the archive switch
 * reads. That is fetched as a bare boolean expression rather than the whole blob, so the
 * column never crosses the wire.
 */
const LIST_SELECT =
  "id, report_month, title, status, generated_by, created_at, reviewed_by, reviewed_at, review_note, " +
  // `alias:column` rather than `column AS alias`: PostgREST treats `AS` as part of the field
  // name when the expression contains a jsonb operator, so the row comes back keyed
  // `data_archivedASdata_archived` with a null value. The colon form keeps the alias intact.
  // Verified against production before being relied on.
  "data_archived:summary_json->>data_archived";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("reports")
    .select(LIST_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reports = (data ?? []).map((row) => {
    const r = row as unknown as PastReportRow & { data_archived?: unknown };
// `->>` yields text, so `true` arrives as the string "true" and a report archived before
  // the flag existed arrives as null. Both are normalised here; the view mapper only ever
  // sees a real boolean, so it cannot mistake the string "false" for a truthy value.
  const raw = r.data_archived;
  const dataArchived = raw === null || raw === undefined ? true : raw === true || raw === "true";
  return toReportRowView({ ...r, summary_json: { data_archived: dataArchived } });
  });

  return NextResponse.json({ reports });
}