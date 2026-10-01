import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, validationFailed, zodFields } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { getClientIp } from "@/lib/auth/ip-hash";
import {
  fetchMembers,
  safeParseMemberQuery,
  type MemberQuery,
} from "@/features/members/member-query";
import { createMember } from "@/features/members/server/create-member";
import { createMemberSchema, toCreateMemberInput } from "@/features/members/member-input";

const ROLES = ["admin", "treasurer", "member", "officer", "secretary"] as const;

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [...ROLES]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = safeParseMemberQuery(url.searchParams);

  if (!parsed.success) {
    return validationFailed("Check the filters and try again.", zodFields(parsed.error));
  }

  const query: MemberQuery = parsed.data;

  try {
    const result = await fetchMembers(query);
    return jsonOk(result);
  } catch (e) {
    console.error("[admin/members] list failed:", e instanceof Error ? e.message : e);
    return internalError("Could not load the member list.");
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return validationFailed("Check the details and try again.", {
      _form: "Could not read the request.",
    });
  }

  // The sheet sends snake_case column names, so validate before mapping. Casting
  // used to let `first_name` through as an undefined `firstName`.
  const parsed = createMemberSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed("Check the details and try again.", zodFields(parsed.error));
  }

  const result = await createMember(toCreateMemberInput(parsed.data));

  if (result.ok) {
    await logAudit({
      action: "member_created",
      actor: {
        role: g.session.role,
        memberId: g.session.actor?.id ?? null,
        name: g.session.actor?.name ?? null,
      },
      entityType: "member",
      entityId: result.memberId,
      ip: getClientIp(req.headers),
      meta: { full_name: result.fullName, source: "admin" },
    });
    return jsonOk({ id: result.memberId, full_name: result.fullName }, { status: 201 });
  }

  if (result.reason === "conflict") {
    return validationFailed("That name is already in use.", {
      _form: `An active member named ${result.conflictName} already exists.`,
    });
  }

  return validationFailed("Check the details and try again.", { _form: result.message });
}
