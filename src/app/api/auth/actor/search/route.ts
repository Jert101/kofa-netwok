import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const ALL_ROLES = ["admin", "secretary", "member", "officer", "treasurer", "super_admin"] as const;

/**
 * Active members for the AUTH-4 person picker. Returns id and name only, since
 * that is all the self-declared actor needs.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [...ALL_ROLES]);
  if (!g.ok) return g.response;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  try {
    let query = getSupabaseAdmin()
      .from("members")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(25);

    if (q.length > 0) {
      const safe = q.replace(/[%,()]/g, " ").trim();
      if (safe.length > 0) {
        query = query.ilike("full_name", `%${safe}%`);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error("[auth/actor/search] failed:", error.message);
      return internalError();
    }

    return jsonOk({
      members: (data ?? []).map((m) => ({ id: String(m.id), name: String(m.full_name) })),
    });
  } catch (e) {
    console.error("[auth/actor/search] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
