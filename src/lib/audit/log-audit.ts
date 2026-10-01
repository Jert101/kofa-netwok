import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ipHashFor } from "@/lib/auth/ip-hash";
import type { Role } from "@/lib/auth/roles";
import { sanitizeMeta } from "./sanitize";
import type { AuditAction } from "./actions";

export type AuditActor = {
  role: Role | null;
  memberId: string | null;
  name: string | null;
};

export type AuditEntry = {
  action: AuditAction;
  actor?: AuditActor | null;
  entityType?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
  /** Raw client address; hashed before it is stored. */
  ip?: string | null;
};

/**
 * Writes one audit row. Never throws and never rejects: a failed audit write
 * must not roll back or break the action the user actually asked for. Failures
 * go to the server log instead.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const actor = entry.actor ?? null;
    const row = {
      actor_role: actor?.role ?? null,
      actor_member_id: actor?.memberId ?? null,
      actor_name: actor?.name ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId),
      meta: sanitizeMeta(entry.meta ?? {}),
      ip_hash: ipHashFor(entry.ip ?? null),
    };
    const { error } = await getSupabaseAdmin().from("audit_log").insert(row);
    if (error) {
      console.error(`[audit] failed to log ${entry.action}:`, error.message);
    }
  } catch (e) {
    console.error(`[audit] failed to log ${entry.action}:`, e instanceof Error ? e.message : e);
  }
}
