import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { badRequest, internalError, jsonOk, zodFields } from "@/lib/api/response";
import { revokeSessions } from "@/lib/auth/pin-service";
import { setSessionCookie } from "@/lib/auth/session";
import { getClientIp } from "@/lib/auth/ip-hash";
import { clearLoginBlocks } from "@/lib/auth/throttle";
import { logAudit } from "@/lib/audit/log-audit";

const bodySchema = z
  .object({
    role: z.enum(["admin", "secretary", "member", "officer", "treasurer", "super_admin"]),
  })
  .optional();

/**
 * AUTH-3 "Sign out all devices" for one role, and the shared-IP escape hatch
 * "Clear login blocks" for when a church wifi locks everyone out at once.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown = null;
  try {
    const text = await req.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    return badRequest("Invalid JSON");
  }

  if (json && typeof json === "object" && "clearLoginBlocks" in json) {
    try {
      const cleared = await clearLoginBlocks();
      await logAudit({
        action: "sessions_revoked",
        actor: {
          role: g.session.role,
          memberId: g.session.actor?.id ?? null,
          name: g.session.actor?.name ?? null,
        },
        entityType: "throttle",
        entityId: "login_attempts",
        meta: { clearedLoginBlocks: cleared },
        ip: getClientIp(req.headers),
      });
      return jsonOk({ clearedLoginBlocks: cleared });
    } catch (e) {
      console.error("[pins/revoke] clear blocks failed:", e instanceof Error ? e.message : e);
      return internalError();
    }
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return badRequest("A role is required.", zodFields(parsed.error));
  if (!parsed.data) return badRequest("A role is required.", { role: "A role is required." });

  const { role } = parsed.data;
  try {
    await revokeSessions(role);
    if (g.session.role === role) {
      await setSessionCookie(g.session.role, g.session.actor ?? null);
    }
    await logAudit({
      action: "sessions_revoked",
      actor: {
        role: g.session.role,
        memberId: g.session.actor?.id ?? null,
        name: g.session.actor?.name ?? null,
      },
      entityType: "role",
      entityId: role,
      meta: { scope: "all_devices" },
      ip: getClientIp(req.headers),
    });
    return jsonOk({ role, revoked: true });
  } catch (e) {
    console.error("[pins/revoke] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
