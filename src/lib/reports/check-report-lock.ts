import type { SupabaseClient } from "@supabase/supabase-js";

export async function guardReportNotGenerated(
  sb: SupabaseClient,
  sessionDate: string,
): Promise<{ blocked: true; message: string } | { blocked: false }> {
  const monthStart = sessionDate.slice(0, 7) + "-01";
  const { data } = await sb
    .from("reports")
    .select("id")
    .eq("report_month", monthStart)
    .maybeSingle();
  if (data) {
    return { blocked: true, message: "Cannot modify attendance for a month that has already been reported." };
  }
  return { blocked: false };
}
