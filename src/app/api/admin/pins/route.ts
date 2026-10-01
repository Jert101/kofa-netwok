import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { badRequest, conflict, internalError, jsonOk, zodFields } from "@/lib/api/response";
import { checkPin, checkPinConfirmation } from "@/lib/auth/pin-rules";
import { findRoleUsingPin, findRolesOnDefaultPin, savePin } from "@/lib/auth/pin-service";
import { setSessionCookie } from "@/lib/auth/session";
import { DEFAULT_PIN_ROLES_COOKIE } from "@/lib/auth/constants";
import type { Role } from "@/lib/auth/roles";
import { getClientIp } from "@/lib/auth/ip-hash";
import { logAudit } from "@/lib/audit/log-audit";

const bodySchema = z.object({
  role: z.enum(["admin", "secretary", "member", "officer", "treasurer", "super_admin"]),
  pin: z.string().max(12),
  confirm: z.string().max(12),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return badRequest("Invalid PIN request", zodFields(parsed.error));

  const { role, pin, confirm } = parsed.data;
  const clearing = pin.trim().length === 0;

  // Only the super admin PIN may be cleared (that turns report approval off).
  if (clearing && role !== "super_admin") {
    return badRequest("This PIN cannot be cleared. Set a PIN instead.", {
      pin: "Enter a PIN.",
    });
  }

  if (!clearing) {
    const rules = checkPin(pin);
    if (!rules.ok) return badRequest(rules.message, { pin: rules.message });

    const confirmCheck = checkPinConfirmation(pin, confirm);
    if (!confirmCheck.ok) {
      return badRequest(confirmCheck.message, { confirm: confirmCheck.message });
    }
  }

  try {
    if (!clearing) {
      const other = await findRoleUsingPin(pin.trim(), role);
      if (other) {
        return conflict(
          "PIN_IN_USE",
          "This PIN is already used by another role. Choose a different one.",
        );
      }
    }

    const result = await savePin(role, clearing ? "" : pin.trim());
    if (!result.ok) {
      return conflict("CONFLICT", result.message);
    }

    // The admin login cached the default-PIN role list in a cookie for the blocking
    // banner. Recheck it here so the banner goes away the moment it is fixed.
    const remaining = await findRolesOnDefaultPin().catch(() => [] as Role[]);

    // Changing your own PIN just revoked your own session; reissue it so the
    // admin who made the change is not immediately signed out.
    if (g.session.role === role) {
      await setSessionCookie(g.session.role, g.session.actor ?? null);
    }

    await logAudit({
      action: "pin_changed",
      actor: {
        role: g.session.role,
        memberId: g.session.actor?.id ?? null,
        name: g.session.actor?.name ?? null,
      },
      entityType: "role",
      entityId: role,
      meta: { cleared: clearing, sessionsRevoked: result.revokedSessions },
      ip: getClientIp(req.headers),
    });

    const res = jsonOk({
      role,
      cleared: clearing,
      sessionsRevoked: result.revokedSessions,
      defaultPinRoles: remaining,
    });
    res.cookies.set(DEFAULT_PIN_ROLES_COOKIE, remaining.join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e) {
    console.error("[pins] failed to save PIN:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
