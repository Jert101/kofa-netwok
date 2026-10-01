/**
 * Editing, deactivating and reactivating a member (module 03, MEM-3).
 *
 * Records are never hard-deleted: deactivation flips the flag and records when and
 * why, so an attendance history keeps making sense years later.
 */

import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, type AuditActor } from "@/lib/audit/log-audit";
import { composeFullName, splitName, normalizeName } from "@/lib/members/normalize-name";
import { DEACTIVATION_REASON_MAX, formatDeactivationReason } from "@/features/members/deactivation";
import { isReasonableBirthDate, memberEditSchema } from "@/features/members/member-input";

export { isReasonableBirthDate, memberEditSchema };

export const deactivateSchema = z.object({
  reason: z.string().min(1, "Choose a reason.").max(DEACTIVATION_REASON_MAX).trim(),
  note: z.string().max(DEACTIVATION_REASON_MAX).trim().optional().nullable(),
});

export type MemberWriteResult =
  | { ok: true }
  | { ok: false; code: "conflict"; message: string; conflictName: string; conflictId: string }
  | { ok: false; code: "invalid"; message: string; fields?: Record<string, string> }
  | { ok: false; code: "missing"; message: string };

type ExistingMember = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  contact_number: string | null;
  batch: string | null;
  is_active: boolean;
};

async function loadMember(id: string): Promise<ExistingMember | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("members")
    .select("id, full_name, date_of_birth, gender, contact_number, batch, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExistingMember | null) ?? null;
}

export type EditArgs = {
  id: string;
  changes: z.infer<typeof memberEditSchema>;
  actor: AuditActor;
  ip?: string | null;
};

export async function editMember({
  id,
  changes,
  actor,
  ip,
}: EditArgs): Promise<MemberWriteResult> {
  const existing = await loadMember(id);
  if (!existing) return { ok: false, code: "missing", message: "That member no longer exists." };

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    updates[key] = value === "" ? null : value;
  }
  if (Object.keys(updates).length === 0) {
    return { ok: false, code: "invalid", message: "Nothing to change." };
  }

  // The stored name is one column, so a name edit has to be recomposed from the
  // parts, taking any part the admin did not touch from what is already there.
  const nameTouched =
    updates.first_name !== undefined ||
    updates.last_name !== undefined ||
    updates.middle_initial !== undefined;

  if (nameTouched) {
    const parts = splitName(existing.full_name);
    const first = (updates.first_name as string | undefined) ?? parts.firstName;
    const last = (updates.last_name as string | undefined) ?? parts.lastName;
    const middle =
      updates.middle_initial !== undefined
        ? (updates.middle_initial as string | null)
        : (parts.middleInitial ?? null);

    if (!first || !last) {
      return { ok: false, code: "invalid", message: "A first and last name are both needed." };
    }

    const nextName = composeFullName({ firstName: first, middleInitial: middle, lastName: last });
    if (!normalizeName(nextName)) {
      return { ok: false, code: "invalid", message: "That name is not usable." };
    }

    // Renaming to a name another active member holds would create the duplicate
    // the whole duplicate check exists to prevent.
    if (normalizeName(nextName) !== normalizeName(existing.full_name) && existing.is_active) {
      const { data: others } = await getSupabaseAdmin()
        .from("members")
        .select("id, full_name")
        .eq("is_active", true)
        .neq("id", id);

      for (const other of others ?? []) {
        if (normalizeName(other.full_name as string) === normalizeName(nextName)) {
          return {
            ok: false,
            code: "conflict",
            conflictName: other.full_name as string,
            conflictId: other.id as string,
            message: `An active member named ${other.full_name} already uses that name.`,
          };
        }
      }
    }

    updates.full_name = nextName;
  }

  const { error } = await getSupabaseAdmin().from("members").update(updates).eq("id", id);
  if (error) {
    return { ok: false, code: "invalid", message: error.message };
  }

  await logAudit({
    action: "member_updated",
    actor,
    entityType: "member",
    entityId: id,
    ip,
    meta: {
      full_name: (updates.full_name as string) ?? existing.full_name,
      changed: Object.keys(updates),
    },
  });

  return { ok: true };
}

export type DeactivateArgs = {
  id: string;
  reason: string;
  note?: string | null;
  actor: AuditActor;
  ip?: string | null;
};

export async function deactivateMember({
  id,
  reason,
  note,
  actor,
  ip,
}: DeactivateArgs): Promise<MemberWriteResult> {
  const existing = await loadMember(id);
  if (!existing) return { ok: false, code: "missing", message: "That member no longer exists." };
  if (!existing.is_active) {
    return { ok: false, code: "invalid", message: "This member is already inactive." };
  }

  const { error } = await getSupabaseAdmin()
    .from("members")
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
      deactivation_reason: formatDeactivationReason(reason, note),
    })
    .eq("id", id);

  if (error) return { ok: false, code: "invalid", message: error.message };

  await logAudit({
    action: "member_deactivated",
    actor,
    entityType: "member",
    entityId: id,
    ip,
    meta: { full_name: existing.full_name, reason, note: note ?? null },
  });

  return { ok: true };
}

export async function reactivateMember({
  id,
  actor,
  ip,
}: Omit<DeactivateArgs, "reason" | "note">): Promise<MemberWriteResult> {
  const existing = await loadMember(id);
  if (!existing) return { ok: false, code: "missing", message: "That member no longer exists." };
  if (existing.is_active) {
    return { ok: false, code: "invalid", message: "This member is already active." };
  }

  // MEM-3: reactivating fails the same way an approval does, so the two never
  // disagree about what counts as a clash.
  if (normalizeName(existing.full_name)) {
    const { data: others } = await getSupabaseAdmin()
      .from("members")
      .select("id, full_name")
      .eq("is_active", true);

    for (const other of others ?? []) {
      if (normalizeName(other.full_name as string) === normalizeName(existing.full_name)) {
        return {
          ok: false,
          code: "conflict",
          conflictName: other.full_name as string,
          conflictId: other.id as string,
          message: `A member named ${other.full_name} is already active. Link this one to that member, edit the name, or leave it inactive.`,
        };
      }
    }
  }

  const { error } = await getSupabaseAdmin()
    .from("members")
    .update({ is_active: true, deactivated_at: null, deactivation_reason: null })
    .eq("id", id);

  if (error) return { ok: false, code: "invalid", message: error.message };

  await logAudit({
    action: "member_reactivated",
    actor,
    entityType: "member",
    entityId: id,
    ip,
    meta: { full_name: existing.full_name },
  });

  return { ok: true };
}
