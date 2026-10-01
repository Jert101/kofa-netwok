import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonOk } from "@/lib/api/response";

/** Public so `/register` can fill the batch dropdown without signing in. */
export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("member_batches")
    .select("year")
    .order("year", { ascending: false });

  if (error) {
    console.error("[public/batches] query failed", error);
    return jsonOk({ batches: [] as string[] });
  }

  const batches = (data ?? [])
    .map((row) => (row as { year?: unknown }).year)
    .filter((year): year is string => typeof year === "string" && year.length > 0);

  return jsonOk({ batches });
}
