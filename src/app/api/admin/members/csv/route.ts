import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, validationFailed, zodFields } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { getClientIp } from "@/lib/auth/ip-hash";
import { fetchAllMembers, safeParseMemberQuery } from "@/features/members/member-query";

const HEADERS = [
  "Name",
  "Batch",
  "Date of birth",
  "Gender",
  "Contact number",
  "Status",
  "Deactivated on",
  "Deactivation reason",
];

/**
 * MEM-7: the CSV covers exactly the rows the directory is showing, because both
 * read the same filter description.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = safeParseMemberQuery(url.searchParams);
  if (!parsed.success) {
    return validationFailed("Check the filters and try again.", zodFields(parsed.error));
  }
  const query = parsed.data;

  let rows: Awaited<ReturnType<typeof fetchAllMembers>>;
  try {
    rows = await fetchAllMembers(query);
  } catch (e) {
    console.error("[admin/members/csv] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build the export.");
  }

  const lines = [HEADERS.map(csvCell).join(",")];
  for (const row of rows) {
    const deactivatedAt = row.deactivated_at
      ? new Date(row.deactivated_at).toISOString().slice(0, 10)
      : "";
    lines.push(
      [
        row.full_name,
        row.batch ?? "",
        row.date_of_birth ?? "",
        row.gender ?? "",
        row.contact_number ?? "",
        row.is_active ? "Active" : "Inactive",
        deactivatedAt,
        row.deactivation_reason ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  await logAudit({
    action: "report_downloaded",
    actor: {
      role: g.session.role,
      memberId: g.session.actor?.id ?? null,
      name: g.session.actor?.name ?? null,
    },
    entityType: "member_directory",
    ip: getClientIp(req.headers),
    meta: { format: "csv", rows: rows.length, filter: { ...query } },
  });

  // A BOM so Excel opens the accented names correctly.
  const body = `\uFEFF${lines.join("\r\n")}\r\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="members.csv"',
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Quotes a value and doubles any quote inside it, so a name containing a comma or
 * a quotation mark cannot shift every column after it.
 */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
