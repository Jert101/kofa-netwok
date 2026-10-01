import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import {
  badRequest,
  conflict,
  internalError,
  jsonOk,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import { getClientIp } from "@/lib/auth/ip-hash";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  deactivateMember,
  deactivateSchema,
  editMember,
  memberEditSchema,
  reactivateMember,
} from "@/features/members/server/write-member";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  action: z.enum(["update", "deactivate", "reactivate"]).default("update"),
});

/** MEM-4 section 1. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), [
    "admin",
    "treasurer",
    "member",
    "officer",
    "secretary",
  ]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  const { data, error } = await getSupabaseAdmin()
    .from("members")
    .select(
      `id, full_name, date_of_birth, gender, contact_number, batch, is_active,
       deactivated_at, deactivation_reason, created_at`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return internalError("Could not load that member.");
  if (!data) return badRequest("That member no longer exists.");

  return jsonOk({ member: data });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const shape = bodySchema.safeParse(json);
  if (!shape.success) {
    return validationFailed("Check the details and try again.", zodFields(shape.error));
  }

  const { action } = shape.data;
  const actor = {
    role: g.session.role,
    memberId: g.session.actor?.id ?? null,
    name: g.session.actor?.name ?? null,
  };
  const ip = getClientIp(req.headers);
  const body = json as Record<string, unknown>;

  if (action === "update") {
    const parsed = memberEditSchema.safeParse(body);
    if (!parsed.success) {
      return validationFailed("Check the details and try again.", zodFields(parsed.error));
    }
    const result = await editMember({ id, changes: parsed.data, actor, ip });
    return respond(result, id);
  }

  if (action === "deactivate") {
    const parsed = deactivateSchema.safeParse(body);
    if (!parsed.success) {
      return validationFailed("Check the reason and try again.", zodFields(parsed.error));
    }
    const result = await deactivateMember({
      id,
      reason: parsed.data.reason,
      note: parsed.data.note,
      actor,
      ip,
    });
    return respond(result, id);
  }

  const result = await reactivateMember({ id, actor, ip });
  return respond(result, id);
}

function respond(
  result: Awaited<ReturnType<typeof editMember>>,
  id: string,
): ReturnType<typeof jsonOk> {
  if (result.ok) return jsonOk({ id });

  if (result.code === "conflict") {
    return conflict("CONFLICT", result.message, {
      conflict_member_id: result.conflictId,
      conflict_name: result.conflictName,
    });
  }
  if (result.code === "missing") {
    return badRequest(result.message);
  }
  if (result.code === "invalid" && result.fields) {
    return validationFailed(result.message, result.fields);
  }
  return internalError(result.message);
}
