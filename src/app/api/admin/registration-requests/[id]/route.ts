import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  badRequest,
  conflict,
  internalError,
  jsonOk,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { getClientIp } from "@/lib/auth/ip-hash";
import {
  decideRequest,
  linkRequestToMember,
  type RequestRow,
} from "@/features/registrations/server/decide-request";
import { normalizeRegisterInput } from "@/features/registrations/schemas";
import { notify } from "@/lib/notify/notify";

const SELECT = `
  id, first_name, last_name, middle_initial, date_of_birth, gender,
  contact_number, batch, status, reference_code, reject_reason,
  created_at, reviewed_at, possible_duplicate_member_id, approved_member_id,
  approval_created_member
`;

const editSchema = z.object({
  first_name: z.string().min(1).max(100).trim().optional(),
  middle_initial: z.string().max(1).trim().optional().nullable(),
  last_name: z.string().min(1).max(100).trim().optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  gender: z.enum(["male", "female"]).optional().nullable(),
  contact_number: z.string().max(20).trim().optional().nullable(),
  batch: z.string().regex(/^\d{4}$/).optional().nullable(),
});

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "update", "change-status", "link-member"]),
  new_status: z.enum(["pending", "approved", "rejected"]).optional(),
  reason: z.string().max(200).trim().optional(),
  note: z.string().max(200).trim().optional().nullable(),
  member_id: z.string().uuid().optional(),
});

/** REG-4: an approved row is edited through the member record, not here. */
function editAllowed(status: string): boolean {
  return status === "pending" || status === "rejected";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed("Check the details and try again.", zodFields(parsed.error));
  }

  const { action, new_status, reason, note, member_id, ...fields } = parsed.data;
  const sb = getSupabaseAdmin();
  const ip = getClientIp(req.headers);

  const { data, error: fetchErr } = await sb
    .from("registration_requests")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return internalError("Could not load the application.");
  }
  if (!data) {
    return badRequest("That application no longer exists.");
  }

  const request = data as unknown as RequestRow;
  const actor = {
    role: g.session.role,
    memberId: g.session.actor?.id ?? null,
    name: g.session.actor?.name ?? null,
  };

  if (action === "update") {
    if (!editAllowed(request.status)) {
      return conflict(
        "CONFLICT",
        "This application was approved, so it is now a member. Edit the member instead.",
      );
    }

    // Reuse the public form's normalization so an admin edit and a public
    // application cannot end up stored in two different shapes.
    const normalized = normalizeRegisterInput(fields);
    const editParsed = editSchema.safeParse(normalized);
    if (!editParsed.success) {
      return validationFailed("Check the details and try again.", zodFields(editParsed.error));
    }

    const updates: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(editParsed.data)) {
      if (val === undefined) continue;
      updates[key] = val === "" ? null : val;
    }
    if (Object.keys(updates).length === 0) {
      return badRequest("Nothing to change.");
    }

    const { error: upErr } = await sb
      .from("registration_requests")
      .update(updates)
      .eq("id", id);

    if (upErr) {
      return internalError("Could not save the changes.");
    }

    await logAudit({
      action: "registration_edited",
      actor,
      entityType: "registration_request",
      entityId: id,
      ip,
      meta: { changed: Object.keys(updates) },
    });

    return jsonOk({ id });
  }

  if (action === "link-member") {
    if (!member_id) return badRequest("Choose the member to link.");

    // REG-6, third option. On a pending or rejected application this is how the
    // admin says "this is someone who is already on the roll": the request is
    // approved and pointed at that member, and no second member is inserted.
    if (request.status === "pending" || request.status === "rejected") {
      const linked = await linkRequestToMember({ request, memberId: member_id, actor, ip });
      if (!linked.ok) {
        if (linked.code === "already") return conflict("CONFLICT", linked.message);
        return internalError(linked.message);
      }
      return jsonOk({ id, status: linked.status, approved_member_id: member_id });
    }

    // Already approved: the admin is re-pointing the link at a different member,
    // so the one this approval created is put aside. Only a member *this* approval
    // created may be deactivated, and the flag is cleared so that undoing the
    // approval later does not touch the newly linked member.
    if (request.approved_member_id && request.approved_member_id !== member_id) {
      if (request.approval_created_member) {
        const { error: offErr } = await sb
          .from("members")
          .update({
            is_active: false,
            deactivated_at: new Date().toISOString(),
            deactivation_reason: "Linked to an existing member instead.",
          })
          .eq("id", request.approved_member_id);
        if (offErr) return internalError("Could not unlink the member this approval created.");
      }

      const { error } = await sb
        .from("registration_requests")
        .update({
          approved_member_id: member_id,
          approval_created_member: false,
          reject_reason: null,
        })
        .eq("id", id);
      if (error) return internalError("Could not link the member.");

      await logAudit({
        action: "registration_status_changed",
        actor,
        entityType: "registration_request",
        entityId: id,
        ip,
        meta: { linked_member_id: member_id, relinked: true },
      });
      return jsonOk({ id, approved_member_id: member_id });
    }

    return jsonOk({ id, approved_member_id: request.approved_member_id });
  }

  const target =
    action === "approve"
      ? "approved"
      : action === "reject"
        ? "rejected"
        : new_status;

  if (!target) {
    return badRequest("Choose what to change the status to.");
  }

  if (request.status !== "pending" && action !== "change-status") {
    return conflict("CONFLICT", `This application was already ${request.status}.`);
  }

  // REG-5: a rejection has to say why.
  if (target === "rejected" && !reason) {
    return badRequest("Choose a reason so the applicant can be told.");
  }

  const result = await decideRequest({
    request,
    next: target,
    actor,
    ip,
    reject: target === "rejected" ? { reason: reason ?? "", note } : null,
  });

  if (!result.ok) {
    if (result.code === "conflict") {
      // REG-6: the message and both ids travel together so the UI can offer
      // "Edit name" and "Reject as duplicate" without a second lookup.
      return conflict("CONFLICT", result.message, {
        conflict_member_id: result.conflictId,
        conflict_name: result.conflictName,
      });
    }
    if (result.code === "already") {
      return conflict("CONFLICT", result.message);
    }
    return internalError(result.message);
  }

  // COM-5: the applicant hears the outcome from the catalog, not from this route. `change-status`
  // back to pending is not news, so it is only an approve or a reject that gets pushed.
  if (target === "approved" || target === "rejected") {
    await notify(
      "registration_reviewed",
      {
        member_name: `${request.first_name} ${request.last_name}`.trim(),
        outcome: target,
      },
      { fromRole: g.session.role },
    );
  }

  return jsonOk({ id, status: result.status, member_id: result.memberId });
}
