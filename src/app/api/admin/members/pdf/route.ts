import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAllSettings } from "@/lib/settings/store";
import { formatNameLastFirst } from "@/lib/members/name-format";
import { buildActiveMembersPdf } from "@/lib/reports/members-pdf";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const filterBatch = url.searchParams.get("batch");
  const filterGender = url.searchParams.get("gender");
  const filterStatus = url.searchParams.get("status");
  const filterBirthMonth = url.searchParams.get("birth_month");

  const sb = getSupabaseAdmin();
  let query = sb
    .from("members")
    .select("full_name, is_active, gender, date_of_birth, batch");

  if (filterBatch) query = query.eq("batch", filterBatch);
  if (filterGender) query = query.eq("gender", filterGender);
  if (filterStatus === "active") query = query.eq("is_active", true);
  else if (filterStatus === "inactive") query = query.eq("is_active", false);
  else query = query.eq("is_active", true);

  const { data, error } = await query.order("full_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let filtered = data ?? [];
  if (filterBirthMonth) {
    const month = filterBirthMonth.padStart(2, "0");
    filtered = filtered.filter((m) => (m.date_of_birth as string)?.slice(5, 7) === month);
  }

  const names = filtered
    .map((m) => formatNameLastFirst((m.full_name as string) ?? ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const parts: string[] = [];
  if (filterBatch) parts.push(`Batch ${filterBatch}`);
  if (filterGender) parts.push(filterGender);
  if (filterStatus) parts.push(filterStatus);
  if (filterBirthMonth) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    parts.push(`${months[parseInt(filterBirthMonth) - 1]} birthdays`);
  }
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  const title = `Members List${suffix}`;
  const label = `Total members: ${names.length}`;

  let churchName = "Knights of the Altar";
  try {
    const settings = await getAllSettings();
    churchName = settings.church_name || churchName;
  } catch {
    // keep fallback name
  }

  const pdf = buildActiveMembersPdf({
    churchName,
    title,
    label,
    generatedAt: new Date(),
    names,
  });
  const body = Buffer.from(pdf);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="active-members-list.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
