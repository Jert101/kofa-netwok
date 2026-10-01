/**
 * Decides what happens to a registration request.
 *
 * Both the single-request route and the bulk route call in here, so a bulk
 * approve cannot behave differently from a single one (module 03, REG-4/REG-5/REG-6).
 *
 * Rules from the spec:
 * - Approval, rejection and status changes stamp reviewed_at and write an audit row.
 * - A rejected request keeps its reason when moved back to pending; approval clears it.
 * - Nothing is inserted when approval hits a name conflict.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, type AuditActor } from "@/lib/audit/log-audit";
import { createMember } from "@/features/members/server/create-member";
import { findPossibleDuplicate } from "@/features/registrations/server/duplicates";
import { formatRejectReason, type RejectInput } from "@/features/registrations/reject-reasons";

export type { RejectInput };

export type RequestRow = {
  id: string;
  first_name: string;
  last_name: string;
  middle_initial: string | null;
  date_of_birth: string | null;
  gender: string | null;
  contact_number: string | null;
  batch: string | null;
  status: "pending" | "approved" | "rejected";
  approved_member_id: string | null;
  approval_created_member: boolean;
  reject_reason: string | null;
};

export type RequestStatus = RequestRow["status"];

export type DecisionResult =
  | { ok: true; status: RequestStatus; memberId: string | null }
  | { ok: false; code: "conflict"; message: string; conflictName: string; conflictId: string }
  | { ok: false; code: "invalid"; message: string }
  | { ok: false; code: "already"; message: string };

/**
 * Undoes an approval without touching anyone else's record.
 *
 * The old code deleted the member by matching name and birth date, which could
 * remove an unrelated member who happened to share them. Now the link recorded at
 * approval time is followed, and only when this approval is what created the
 * member: a request that was *linked* to a member who already existed leaves that
 * person exactly as they were.
 *
 * A member who has since served is deactivated rather than deleted, so no
 * attendance history is lost.
 */
async function undoApproval(
  request: RequestRow,
  actor: AuditActor,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const sb = getSupabaseAdmin();
  const memberId = request.approved_member_id;

  // Nothing was created by this approval, or the link predates migration 025 and
  // cannot be trusted. Either way the member is not ours to touch.
  if (!memberId || !request.approval_created_member) return { ok: true };

  const { data: member } = await sb
    .from("members")
    .select("id, is_active, full_name")
    .eq("id", memberId)
    .maybeSingle();

  if (!member) return { ok: true };

  // Every table that points at members has to be counted, not just attendance.
  // liturgy_planned and session_liturgy_servers both use ON DELETE SET NULL, so
  // deleting a member who is on a planned liturgy would blank the member_id and
  // leave a role label with no name attached — a ghost slot that silently
  // disappears from the officer's planner.
  const [live, archived, planned, serving] = await Promise.all([
    sb.from("attendance_records").select("id", { count: "exact", head: true }).eq("member_id", memberId),
    sb
      .from("attendance_records_archive")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId),
    sb
      .from("liturgy_planned")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId),
    sb
      .from("session_liturgy_servers")
      .select("id", { count: "exact", head: true })
      .eq("member_id", memberId),
  ]);

  if (live.error || archived.error || planned.error || serving.error) {
    // Unknown whether this member can be deleted, so stop rather than guess.
    return {
      ok: false,
      message: "Could not check what this member is still needed for, so nothing was changed.",
    };
  }

  const dependedOn =
    (live.count ?? 0) + (archived.count ?? 0) + (planned.count ?? 0) + (serving.count ?? 0);

  if (dependedOn > 0) {
    // Something still points at this row, so it stays and is marked inactive.
    const { error } = await sb
      .from("members")
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
        deactivation_reason: "Registration approval was undone.",
      })
      .eq("id", memberId);

    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await sb.from("members").delete().eq("id", memberId);
    if (error) return { ok: false, message: error.message };
  }

  await logAudit({
    action: "member_deactivated",
    actor,
    entityType: "member",
    entityId: memberId,
    meta: { full_name: member.full_name, reason: "registration_unapproved" },
  });

  return { ok: true };
}

export type DecideArgs = {
  request: RequestRow;
  next: RequestStatus;
  actor: AuditActor;
  ip?: string | null;
  reject?: RejectInput | null;
  /** Set for bulk calls so the audit action matches the action taken. */
  bulk?: boolean;
};

export async function decideRequest({
  request,
  next,
  actor,
  ip,
  reject,
  bulk = false,
}: DecideArgs): Promise<DecisionResult> {
  const sb = getSupabaseAdmin();

  if (request.status === next) {
    return { ok: false, code: "already", message: `Already ${next}.` };
  }

  // Moving away from approved gives the member back, once. If that cannot be done
  // the status is left alone: a request saying "rejected" while its member is still
  // active is worse than an error the admin can retry.
  if (request.status === "approved" && next !== "approved") {
    const undone = await undoApproval(request, actor);
    if (!undone.ok) {
      return { ok: false, code: "invalid", message: undone.message };
    }
  }

  let memberId: string | null = null;
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: next,
    approved_member_id: null,
    approval_created_member: false,
  };

  if (next === "approved") {
    // REG-6: stop and explain rather than inserting a second copy of the person.
    const duplicate = await findPossibleDuplicate({
      firstName: request.first_name,
      middleInitial: request.middle_initial,
      lastName: request.last_name,
    });

    if (duplicate.memberId) {
      return {
        ok: false,
        code: "conflict",
        conflictId: duplicate.memberId,
        conflictName: duplicate.memberName ?? request.first_name,
        message: `A member named ${duplicate.memberName ?? request.first_name} is already active. Link this application to that member, edit the name, or reject.`,
      };
    }

    const created = await createMember({
      firstName: request.first_name,
      middleInitial: request.middle_initial,
      lastName: request.last_name,
      dateOfBirth: request.date_of_birth,
      gender: request.gender,
      contactNumber: request.contact_number,
      batch: request.batch,
    });

    if (!created.ok) {
      if (created.reason === "conflict") {
        return {
          ok: false,
          code: "conflict",
          conflictId: created.conflictId,
          conflictName: created.conflictName,
          message: `A member named ${created.conflictName} is already active. Link this application to that member, edit the name, or reject.`,
        };
      }
      return { ok: false, code: "invalid", message: created.message };
    }

    memberId = created.memberId;
    updates.approved_member_id = memberId;
    updates.approval_created_member = true;
    // A rejected request carries its reason; approval supersedes it.
    updates.reject_reason = null;
  }

  if (next === "rejected") {
    updates.reject_reason = reject ? formatRejectReason(reject) : null;
  }

  if (next === "pending") {
    // Kept, not cleared: the reason explains a past decision and stays useful.
    updates.reviewed_at = null;
  } else {
    updates.reviewed_at = now;
  }

  // Compare-and-set on the status this call read. Without the `.eq`, two admins
  // opening the same application both see "pending", both insert a member, and
  // the person ends up on the roll twice. Zero rows updated means someone else
  // decided first, which REG-6 reports as already reviewed.
  const { data: written, error } = await sb
    .from("registration_requests")
    .update(updates)
    .eq("id", request.id)
    .eq("status", request.status)
    .select("id");

  if (error) {
    // The member insert already happened, so remove it rather than leaving a
    // half-approved pair behind.
    if (memberId) await sb.from("members").delete().eq("id", memberId);
    return { ok: false, code: "invalid", message: error.message };
  }

  if ((written ?? []).length === 0) {
    if (memberId) await sb.from("members").delete().eq("id", memberId);
    return {
      ok: false,
      code: "already",
      message: "Someone else reviewed this application first. Reload to see the current status.",
    };
  }

  const action = bulk
    ? next === "approved"
      ? "registration_bulk_approved"
      : next === "rejected"
        ? "registration_bulk_rejected"
        : "registration_status_changed"
    : next === "approved"
      ? "registration_approved"
      : next === "rejected"
        ? "registration_rejected"
        : "registration_status_changed";

  await logAudit({
    action,
    actor,
    entityType: "registration_request",
    entityId: request.id,
    ip,
    meta: {
      name: `${request.first_name} ${request.last_name}`,
      from: request.status,
      to: next,
      member_id: memberId,
      reject_reason: updates.reject_reason ?? null,
    },
  });

  return { ok: true, status: next, memberId };
}

export type LinkArgs = {
  request: RequestRow;
  memberId: string;
  actor: AuditActor;
  ip?: string | null;
};

/**
 * REG-6, third option: the admin says this application *is* a member who already
 * exists, so the request is approved and pointed at that member instead of a
 * second one being inserted.
 *
 * `approval_created_member` stays false, which is what stops a later
 * un-approval from deactivating the person: this approval did not create them.
 */
export async function linkRequestToMember({
  request,
  memberId,
  actor,
  ip,
}: LinkArgs): Promise<DecisionResult> {
  const sb = getSupabaseAdmin();

  if (request.status === "approved") {
    return { ok: false, code: "already", message: "This application is already approved." };
  }

  const { data: member, error: memberError } = await getSupabaseAdmin()
    .from("members")
    .select("id, full_name")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError) {
    return { ok: false, code: "invalid", message: memberError.message };
  }
  if (!member) {
    return { ok: false, code: "invalid", message: "That member no longer exists." };
  }

  // Same compare-and-set as an ordinary approval, so two admins cannot both
  // attach this application to different members.
  const { data: written, error } = await sb
    .from("registration_requests")
    .update({
      status: "approved",
      approved_member_id: member.id,
      approval_created_member: false,
      reject_reason: null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", request.id)
    .eq("status", request.status)
    .select("id");

  if (error) {
    return { ok: false, code: "invalid", message: error.message };
  }
  if ((written ?? []).length === 0) {
    return {
      ok: false,
      code: "already",
      message: "Someone else reviewed this application first. Reload to see the current status.",
    };
  }

  await logAudit({
    action: "registration_linked_to_member",
    actor,
    entityType: "registration_request",
    entityId: request.id,
    ip,
    meta: {
      name: `${request.first_name} ${request.last_name}`,
      from: request.status,
      to: "approved",
      member_id: member.id,
      member_name: member.full_name,
      linked: true,
    },
  });

  return { ok: true, status: "approved", memberId: member.id };
}
