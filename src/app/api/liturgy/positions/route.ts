import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * LIT-1's position combobox suggestions.
 *
 * Only active labels, ordered by the catalog's own sort order and then alphabetically. Clients
 * filter this list themselves; returning a few hundred short strings is cheaper than a query per
 * keystroke, and the catalog is a suggestion source rather than history — nothing a parish stops
 * using should keep showing up.
 */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!guard.ok) return guard.response;

  const { data, error } = await getSupabaseAdmin()
    .from("liturgy_positions")
    .select("label, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  if (error) return internalError(error.message);

  return Response.json({ labels: (data ?? []).map((r) => String(r.label)) });
}