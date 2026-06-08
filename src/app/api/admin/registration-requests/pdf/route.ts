import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAllSettings } from "@/lib/settings/store";
import { formatNameLastFirst } from "@/lib/members/name-format";
import { buildRegistrationRequestsPdf } from "@/lib/reports/registration-requests-pdf";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "";

  const sb = getSupabaseAdmin();
  let query = sb.from("registration_requests").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? [])
    .map((r) => {
      const mi = r.middle_initial ? ` ${r.middle_initial}.` : "";
      const fullName = `${r.first_name}${mi} ${r.last_name}`;
      return {
        name: formatNameLastFirst(fullName),
        gender: r.gender,
        date_of_birth: r.date_of_birth,
        contact_number: r.contact_number,
        batch: r.batch ?? null,
        status: r.status,
        created_at: new Date(r.created_at).toLocaleString(),
        reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r, idx) => ({ index: idx + 1, ...r }));

  let churchName = "Knights of the Altar";
  try {
    const settings = await getAllSettings();
    churchName = settings.church_name || churchName;
  } catch {
    // keep fallback
  }

  const statusLabel = status ? ` (${status})` : "";
  const pdf = buildRegistrationRequestsPdf({
    churchName,
    title: `Registration Requests${statusLabel}`,
    generatedAt: new Date(),
    rows,
  });
  const body = Buffer.from(pdf);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="registration-requests${status ? `-${status}` : ""}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
