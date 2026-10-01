import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, jsonOk, validationFailed, zodFields } from "@/lib/api/response";
import { getClientIp } from "@/lib/auth/ip-hash";
import {
  decideRequest,
  type RequestRow,
} from "@/features/registrations/server/decide-request";

const SELECT = `
  id, first_name, last_name, middle_initial, date_of_birth, gender,
  contact_number, batch, status, reference_code, reject_reason,
  created_at, reviewed_at, possible_duplicate_member_id, approved_member_id
`;

const MAX_BULK = 200;

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  // REG-4: ids are always required. The old route treated a missing list as
  // "all pending", so one stray click could approve every application.
  ids: z.array(z.string().uuid()).min(1, "Select at least one application.").max(MAX_BULK),
  reason: z.string().max(200).trim().optional(),
  note: z.string().max(200).trim().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed("Check the selection and try again.", zodFields(parsed.error));
  }

  const { action, ids, reason, note } = parsed.data;
  const next = action === "approve" ? "approved" : "rejected";

  // REG-5: a bulk rejection still has to say why, for the same reason a single one does.
  if (next === "rejected" && !reason) {
    return badRequest("Choose a reason so the applicants can be told.");
  }

  const sb = getSupabaseAdmin();
  const ip = getClientIp(req.headers);
  const actor = {
    role: g.session.role,
    memberId: g.session.actor?.id ?? null,
    name: g.session.actor?.name ?? null,
  };

  const { data, error } = await sb
    .from("registration_requests")
    .select(SELECT)
    .in("id", ids);

  if (error) {
    return badRequest("Could not load the selected applications.");
  }

  const rows = (data ?? []) as unknown as RequestRow[];
  const done: string[] = [];
  const skipped: { id: string; name: string; reason: string }[] = [];

  // Each row is decided on its own so one conflict does not abandon the rest, and
  // so a row that fails to save never leaves a member inserted behind it.
  for (const row of rows) {
    const name = `${row.first_name} ${row.last_name}`;

    if (row.status !== "pending") {
      skipped.push({ id: row.id, name, reason: `Already ${row.status}.` });
      continue;
    }

    const result = await decideRequest({
      request: row,
      next,
      actor,
      ip,
      reject: next === "rejected" ? { reason: reason ?? "", note } : null,
      bulk: true,
    });

    if (result.ok) {
      done.push(row.id);
    } else {
      skipped.push({ id: row.id, name, reason: result.message });
    }
  }

  // An id that was sent but not returned did not exist; say so instead of
  // quietly reporting a smaller total than the admin selected.
  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) {
      skipped.push({ id, name: "Unknown", reason: "That application no longer exists." });
    }
  }

  return jsonOk({
    processed: done.length,
    ids: done,
    skipped,
    requested: ids.length,
  });
}
