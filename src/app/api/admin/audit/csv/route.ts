import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/auth/ip-hash";
import { logAudit } from "@/lib/audit/log-audit";
import {
  AUDIT_EXPORT_LIMIT,
  auditSearchFilter,
  parseAuditQuery,
  type AuditRow,
} from "@/lib/audit/query";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: AuditRow[]): string {
  const header = ["at", "action", "actor_role", "actor_name", "entity_type", "entity_id", "meta"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.at,
        row.action,
        row.actor_role ?? "",
        row.actor_name ?? "",
        row.entity_type ?? "",
        row.entity_id ?? "",
        row.meta && Object.keys(row.meta).length > 0 ? row.meta : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const filters = parseAuditQuery(new URL(req.url).searchParams);

  try {
    const sb = getSupabaseAdmin();
    let query = sb
      .from("audit_log")
      .select("id, at, actor_role, actor_name, action, entity_type, entity_id, meta")
      .order("at", { ascending: false })
      .limit(AUDIT_EXPORT_LIMIT);

    if (filters.from) query = query.gte("at", filters.from);
    if (filters.to) query = query.lte("at", filters.to);
    if (filters.role) query = query.eq("actor_role", filters.role);
    if (filters.action) query = query.eq("action", filters.action);
    if (filters.q) query = query.or(auditSearchFilter(filters.q));

    const { data, error } = await query;
    if (error) {
      console.error("[admin/audit/csv] query failed:", error.message);
      return internalError();
    }

    // The export is itself a read of the full log, so it is recorded.
    await logAudit({
      action: "report_downloaded",
      actor: {
        role: g.session.role,
        memberId: g.session.actor?.id ?? null,
        name: g.session.actor?.name ?? null,
      },
      entityType: "audit_log",
      entityId: "csv",
      meta: {
        rows: (data ?? []).length,
        role: filters.role,
        action: filters.action,
        truncated: (data ?? []).length >= AUDIT_EXPORT_LIMIT,
      },
      ip: getClientIp(req.headers),
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(toCsv((data ?? []) as AuditRow[]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[admin/audit/csv] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
