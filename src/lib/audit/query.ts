import { AUDIT_ACTIONS } from "./actions";
import { isRole } from "@/lib/auth/roles";

/** Matches the viewer's page size (module 02 AUTH-5). */
export const AUDIT_PAGE_SIZE = 50;

/** Keeps an export bounded; the viewer paginates for day-to-day use. */
export const AUDIT_EXPORT_LIMIT = 5_000;

export type AuditRow = {
  id: string;
  at: string;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
};

export type AuditQuery = {
  from: string | null;
  to: string | null;
  role: string | null;
  action: string | null;
  q: string | null;
  page: number;
};

/** Parses the viewer's filters. Invalid values are dropped rather than rejected. */
export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  const iso = (raw: string | null) => {
    if (!raw) return null;
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  };
  const role = params.get("role");
  const action = params.get("action");
  const pageRaw = Number.parseInt(params.get("page") ?? "1", 10);

  return {
    from: iso(params.get("from")),
    to: iso(params.get("to")),
    role: role && isRole(role) ? role : null,
    action: action && (AUDIT_ACTIONS as readonly string[]).includes(action) ? action : null,
    q: params.get("q")?.trim() || null,
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  };
}

/** Commas, parentheses and wildcards would break the PostgREST `or` filter syntax. */
export function sanitizeForOr(value: string): string {
  return value.replace(/[,()*%]/g, " ").trim();
}

/** The `or(...)` filter used to search actor name and action. */
export function auditSearchFilter(q: string): string {
  const safe = sanitizeForOr(q);
  return `actor_name.ilike.%${safe}%,action.ilike.%${safe}%`;
}
