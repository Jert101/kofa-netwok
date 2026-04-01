import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAllSettings } from "@/lib/settings/store";
import { buildActiveMembersPdf } from "@/lib/reports/members-pdf";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("members")
    .select("full_name")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let churchName = "Knights of the Altar";
  try {
    const settings = await getAllSettings();
    churchName = settings.church_name || churchName;
  } catch {
    // keep fallback name
  }

  const pdf = buildActiveMembersPdf({
    churchName,
    title: "Active Members List",
    generatedAt: new Date(),
    names: (data ?? []).map((m) => (m.full_name as string) ?? "").filter(Boolean),
  });

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="active-members-list.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
