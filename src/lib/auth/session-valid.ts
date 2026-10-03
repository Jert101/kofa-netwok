import type { SessionPayload } from "./session";
import type { Role } from "./roles";
import { getAllInternalSettings } from "@/lib/settings/store";
type SettingKey = string;

/** Small tolerance so clock skew between signing and checking cannot sign people out. */
export const CLOCK_SKEW_TOLERANCE_MS = 5_000;

export const SESSIONS_VALID_AFTER_KEY: Record<Role, SettingKey> = {
  admin: "sessions_valid_after_admin",
  secretary: "sessions_valid_after_secretary",
  member: "sessions_valid_after_member",
  officer: "sessions_valid_after_officer",
  treasurer: "sessions_valid_after_treasurer",
  super_admin: "sessions_valid_after_super_admin",
};

export const REQUIRE_ACTOR_KEY: Record<Role, SettingKey> = {
  admin: "require_actor_name_admin",
  secretary: "require_actor_name_secretary",
  member: "require_actor_name_member",
  officer: "require_actor_name_officer",
  treasurer: "require_actor_name_treasurer",
  super_admin: "require_actor_name_super_admin",
};

/** Staff roles get the "Who's using this device?" step by default. */
export const ACTOR_REQUIRED_BY_DEFAULT: Record<Role, boolean> = {
  admin: true,
  secretary: true,
  officer: true,
  treasurer: true,
  super_admin: true,
  member: false,
};

function parseValidAfter(value: string | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * Pure check: is a session issued at `issuedAtSeconds` still valid for a role
 * whose `validAfterIso` is set? No setting means nothing has been revoked. The
 * `nowMs` parameter bounds how far in the future a token may claim to be from.
 */
export function isSessionValid(
  issuedAtSeconds: number | undefined,
  validAfterIso: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const validAfter = parseValidAfter(validAfterIso ?? undefined);
  if (validAfter === null) return true;
  if (issuedAtSeconds === undefined || !Number.isFinite(issuedAtSeconds)) return false;
  const issuedAtMs = issuedAtSeconds * 1000;
  // A token dated well into the future is forged or badly skewed; refuse it.
  if (issuedAtMs > nowMs + CLOCK_SKEW_TOLERANCE_MS) return false;
  return issuedAtMs >= validAfter - CLOCK_SKEW_TOLERANCE_MS;
}

/**
 * Server check used by requireRole() and the role layouts. A PIN change or a
 * "Sign out all devices" writes the timestamp; older sessions stop working.
 */
export async function isSessionValidForRole(
  session: SessionPayload,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const settings = await getAllInternalSettings();
  return isSessionValid(session.iat, settings[SESSIONS_VALID_AFTER_KEY[session.role]], nowMs);
}

export function isActorRequired(
  role: Role,
  settings: Record<string, string>,
): boolean {
  const raw = settings[REQUIRE_ACTOR_KEY[role]];
  if (raw === undefined) return ACTOR_REQUIRED_BY_DEFAULT[role];
  return raw === "true";
}
