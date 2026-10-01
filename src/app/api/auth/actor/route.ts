import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { badRequest, internalError, jsonOk, validationFailed, zodFields } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSessionFromCookies, setSessionCookie } from "@/lib/auth/session";
import { getClientIp } from "@/lib/auth/ip-hash";
import { logAudit } from "@/lib/audit/log-audit";

const bodySchema = z.object({
  /** Empty string clears the actor (members may skip). */
  member_id: z.string().max(64),
});

/**
 * AUTH-4 "Who's using this device?". Self-declared identity stored in the
 * session cookie, never a security boundary on its own (D-1).
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [
    "admin",
    "secretary",
    "member",
    "officer",
    "treasurer",
    "super_admin",
  ]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return validationFailed("Choose a person.", zodFields(parsed.error));

  const raw = parsed.data.member_id.trim();

  if (raw === "") {
    const session = await getSessionFromCookies();
    await setSessionCookie(g.session.role, null);
    await logAudit({
      action: "actor_selected",
      actor: { role: g.session.role, memberId: null, name: null },
      entityType: "session",
      entityId: g.session.role,
      meta: { cleared: true },
      ip: getClientIp(req.headers),
    });
    return jsonOk({ actor: null, role: session?.role ?? g.session.role });
  }

  const uuidSchema = z.string().uuid();
  if (!uuidSchema.safeParse(raw).success) {
    return validationFailed("Choose a person from the list.", { member_id: "Choose a person from the list." });
  }

  try {
    const { data: member, error } = await getSupabaseAdmin()
      .from("members")
      .select("id, full_name")
      .eq("id", raw)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("[auth/actor] member lookup failed:", error.message);
      return internalError();
    }
    if (!member) {
      return validationFailed("That person is not an active member.", {
        member_id: "That person is not an active member.",
      });
    }

    const name = String(member.full_name);
    await setSessionCookie(g.session.role, { id: String(member.id), name });

    await logAudit({
      action: "actor_selected",
      actor: { role: g.session.role, memberId: String(member.id), name },
      entityType: "member",
      entityId: String(member.id),
      ip: getClientIp(req.headers),
    });

    return jsonOk({ actor: { id: String(member.id), name }, role: g.session.role });
  } catch (e) {
    console.error("[auth/actor] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
