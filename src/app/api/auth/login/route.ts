import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveRoleFromPin } from "@/lib/auth/pin-login";
import { SESSION_COOKIE, DEFAULT_PIN_ROLES_COOKIE } from "@/lib/auth/constants";
import { signSession } from "@/lib/auth/session";
import {
  badRequest,
  internalError,
  jsonError,
  jsonOk,
  unauthenticated,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import { checkLoginAllowed, recordAttempt } from "@/lib/auth/throttle";
import { getClientIp } from "@/lib/auth/ip-hash";
import { REQUIRE_ACTOR_KEY, isActorRequired } from "@/lib/auth/session-valid";
import { getSettings } from "@/lib/settings/store";
import { logAudit } from "@/lib/audit/log-audit";
import { findRolesOnDefaultPin } from "@/lib/auth/pin-service";
import type { Role } from "@/lib/auth/roles";

const bodySchema = z.object({
  pin: z.string().min(4).max(12),
});

const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const ip = getClientIp(req.headers);

  // AUTH-2: 5 failures per 15 minutes per client, checked before any hashing.
  const throttle = await checkLoginAllowed(ip);
  if (throttle.blocked) {
    const minutes = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60));
    return jsonError(
      "RATE_LIMITED",
      `Too many wrong PINs. Try again in ${minutes} minute${
        minutes === 1 ? "" : "s"
      }.`,
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } },
    );
  }

  if (throttle.globalDelayMs > 0) {
    await new Promise((r) => setTimeout(r, throttle.globalDelayMs));
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed("PIN must be 4-12 characters.", zodFields(parsed.error));
  }

  let role;
  try {
    role = await resolveRoleFromPin(parsed.data.pin);
  } catch (cause) {
    console.error("[auth/login] pin lookup failed", cause);
    return internalError();
  }

  if (!role) {
    await recordAttempt("login", ip, false);
    await logAudit({ action: "login_failed", actor: { role: null, memberId: null, name: null }, ip });
    return unauthenticated("That PIN isn't right.");
  }

  await recordAttempt("login", ip, true);

  let token: string;
  try {
    token = await signSession(role);
  } catch (cause) {
    console.error("[auth/login] signSession failed", cause);
    return internalError();
  }

  // The actor requirement is an *exposed* setting (it is what the settings page edits), so it is
  // never present in the internal map. `getAllInternalSettings` skips exposed keys by design, which
  // meant `isActorRequired` always fell back to the per-role default -- "member" was always false,
  // so the "Who's using this device?" step never appeared for a member, and a staff role's toggle
  // was ignored in the other direction. Read the exposed keys instead.
  const actorSettings = await getSettings([REQUIRE_ACTOR_KEY[role]]).catch(
    () => ({} as Record<string, string>),
  );
  const actorRequired = isActorRequired(role, actorSettings);
  if (role !== "member") {
    await logAudit({ action: "login_succeeded", actor: { role, memberId: null, name: null }, ip });
  }

  // AUTH-1: the default-PIN check runs here (six bcrypt compares) and is cached in a
  // cookie so admin pages can show the blocking banner without re-hashing on every render.
  const defaultPinRoles = await findRolesOnDefaultPin().catch(() => [] as Role[]);

  const res = jsonOk({ role, actorRequired, defaultPinRoles });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  if (role === "admin") {
    res.cookies.set(DEFAULT_PIN_ROLES_COOKIE, defaultPinRoles.join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
  }
  return res;
}
