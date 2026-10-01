import bcrypt from "bcryptjs";
import { getAllSettings, upsertSettings } from "@/lib/settings/store";
import type { SettingKey } from "@/lib/settings/keys";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { SESSIONS_VALID_AFTER_KEY } from "./session-valid";
import { canClearSuperAdminPin, DEFAULT_PIN } from "./pin-rules";
import type { Role } from "./roles";

export const ROLES: Role[] = ["admin", "secretary", "member", "officer", "treasurer", "super_admin"];

export const PIN_HASH_KEY: Record<Role, SettingKey> = {
  admin: "pin_admin_hash",
  secretary: "pin_secretary_hash",
  member: "pin_member_hash",
  officer: "pin_officer_hash",
  treasurer: "pin_treasurer_hash",
  super_admin: "pin_super_admin_hash",
};

export type SharedHash = { roles: Role[] };

/**
 * Roles whose *stored hash* is byte-for-byte the same string.
 *
 * Read this before trusting it as a duplicate-PIN check, because it is not one.
 *
 * AUTH-1 requires every role to have a different PIN, and that is genuinely
 * enforced — but it is enforced in `findRoleUsingPin`, at the moment a PIN is
 * saved, where the plaintext is in hand and `bcrypt.compareSync` can be used
 * properly. Here there are only hashes, and two hashes of the same PIN are
 * different strings, because bcrypt salts every hash differently. There is no way
 * to compare two bcrypt hashes against each other.
 *
 * So this catches the narrower case where one hash was *copied* between roles
 * rather than independently produced — a bad seed, a hand-edited setting, a
 * migration that cloned a value. That is worth knowing about, because it means one
 * role's PIN was set by copying rather than by the app.
 *
 * What this cannot tell you is whether two roles currently share a PIN. If you
 * need that surfaced continuously rather than only at set time, the stored value
 * has to gain a keyed fingerprint of the PIN alongside the bcrypt hash. That is a
 * schema change with a migration, deliberately not done here.
 */
export function findRolesSharingAStoredHash(settings: Record<string, string>): SharedHash[] {
  const groups = new Map<string, Role[]>();
  for (const role of ROLES) {
    const hash = settings[PIN_HASH_KEY[role]];
    if (!hash) continue;
    const list = groups.get(hash) ?? [];
    list.push(role);
    groups.set(hash, list);
  }
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((roles) => ({ roles }));
}

/** Roles still on the shipped `1234` PIN, for the blocking banner. */
export async function findRolesOnDefaultPin(): Promise<Role[]> {
  const settings = await getAllSettings();
  const out: Role[] = [];
  for (const role of ROLES) {
    const hash = settings[PIN_HASH_KEY[role]];
    if (hash && bcrypt.compareSync(DEFAULT_PIN, hash)) out.push(role);
  }
  return out;
}

/**
 * AUTH-1 uniqueness: compares the candidate against the other roles' hashes.
 * A role being re-set to its own current PIN is not a conflict.
 */
export async function findRoleUsingPin(pin: string, except: Role): Promise<Role | null> {
  const settings = await getAllSettings();
  for (const role of ROLES) {
    if (role === except) continue;
    const hash = settings[PIN_HASH_KEY[role]];
    if (hash && bcrypt.compareSync(pin, hash)) return role;
  }
  return null;
}

export async function countPendingReports(): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

/** AUTH-3: invalidates every existing session for a role from now on. */
export async function revokeSessions(role: Role, at: Date = new Date()): Promise<void> {
  await upsertSettings({ [SESSIONS_VALID_AFTER_KEY[role]]: at.toISOString() });
}

export type SavePinResult =
  | { ok: true; revokedSessions: boolean }
  | { ok: false; code: "PIN_IN_USE" | "PENDING_REPORTS_EXIST"; message: string };

/**
 * Saves a hashed PIN and revokes that role's sessions. Clearing the super admin
 * PIN is refused while reports are pending (AUTH-7).
 */
export async function savePin(role: Role, pin: string, at: Date = new Date()): Promise<SavePinResult> {
  if (role === "super_admin" && pin.length === 0) {
    const pending = await countPendingReports();
    const allowed = canClearSuperAdminPin(pending);
    if (!allowed.ok) {
      return { ok: false, code: "PENDING_REPORTS_EXIST", message: allowed.message };
    }
  }

  await upsertSettings({ [PIN_HASH_KEY[role]]: bcrypt.hashSync(pin, 10) });
  await revokeSessions(role, at);
  return { ok: true, revokedSessions: true };
}
