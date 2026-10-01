import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, validationFailed, zodFields } from "@/lib/api/response";
import { getAllSettings } from "@/lib/settings/store";
import { formatNameLastFirst } from "@/lib/members/name-format";
import { buildActiveMembersPdf } from "@/lib/reports/members-pdf";
import { fetchAllMembers, safeParseMemberQuery } from "@/features/members/member-query";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * MEM-7: the PDF keeps its header and columns, and now honours the same filter as
 * the directory page so the two can never show different people.
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

  let members: Awaited<ReturnType<typeof fetchAllMembers>>;
  try {
    members = await fetchAllMembers(query);
  } catch (e) {
    console.error("[admin/members/pdf] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build the PDF.");
  }

  const rows = members
    .map((m) => ({
      name: formatNameLastFirst(m.full_name ?? ""),
      date_of_birth: m.date_of_birth,
      gender: m.gender,
      batch: m.batch,
      contact_number: m.contact_number,
    }))
    .filter((r) => r.name);

  const parts: string[] = [];
  if (query.batch) parts.push(`Batch ${query.batch}`);
  if (query.gender) parts.push(query.gender);
  if (query.status !== "all") parts.push(query.status);
  if (query.birth_month) {
    parts.push(`${MONTHS[Number(query.birth_month) - 1]} birthdays`);
  }
  if (query.q.trim()) parts.push(`matching "${query.q.trim()}"`);

  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  const title = `Members List${suffix}`;
  const label = `Total members: ${rows.length}`;

  let churchName = "Knights of the Altar";
  try {
    const settings = await getAllSettings();
    churchName = settings.church_name || churchName;
  } catch {
    // The fallback is fine; a settings read failure should not block the export.
  }

  const pdf = buildActiveMembersPdf({
    churchName,
    title,
    label,
    generatedAt: new Date(),
    rows,
  });

  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="members-list.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
