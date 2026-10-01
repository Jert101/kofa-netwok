import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AuditAction } from "@/lib/audit/actions";
import {
  AUDIT_PAGE_SIZE,
  auditSearchFilter,
  parseAuditQuery,
  type AuditRow,
} from "@/lib/audit/query";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const filters = parseAuditQuery(new URL(req.url).searchParams);

  try {
    const sb = getSupabaseAdmin();
    let query = sb
      .from("audit_log")
      .select("id, at, actor_role, actor_name, action, entity_type, entity_id, meta", {
        count: "exact",
      })
      .order("at", { ascending: false });

    if (filters.from) query = query.gte("at", filters.from);
    if (filters.to) query = query.lte("at", filters.to);
    if (filters.role) query = query.eq("actor_role", filters.role);
    if (filters.action) query = query.eq("action", filters.action as AuditAction);
    if (filters.q) query = query.or(auditSearchFilter(filters.q));

    const from = (filters.page - 1) * AUDIT_PAGE_SIZE;
    query = query.range(from, from + AUDIT_PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error("[admin/audit] query failed:", error.message);
      return internalError();
    }

    return jsonOk({
      items: (data ?? []) as AuditRow[],
      total: count ?? 0,
      page: filters.page,
      pageSize: AUDIT_PAGE_SIZE,
    });
  } catch (e) {
    console.error("[admin/audit] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
