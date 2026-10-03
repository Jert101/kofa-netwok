import bcrypt from "bcryptjs";
import { getAllInternalSettings } from "@/lib/settings/store";
import type { Role } from "./roles";

const PIN_KEYS: Record<
  Role,
  | "pin_admin_hash"
  | "pin_secretary_hash"
  | "pin_member_hash"
  | "pin_officer_hash"
  | "pin_treasurer_hash"
  | "pin_super_admin_hash"
> = {
  admin: "pin_admin_hash",
  secretary: "pin_secretary_hash",
  member: "pin_member_hash",
  officer: "pin_officer_hash",
  treasurer: "pin_treasurer_hash",
  super_admin: "pin_super_admin_hash",
};

/**
 * Find which role a PIN belongs to.
 *
 * Reads all six hashes in one query through `getAllInternalSettings`, not one `getSetting` call per role.
 *
 * That is not a performance choice, it is a correctness one. `getSetting` validates against the registry
 * and falls back to the declared default when validation fails, and `validateSetting` refuses every key
 * marked `exposed: false` -- which is exactly what a PIN hash is. So `getSetting("pin_admin_hash")`
 * cannot return a hash even when one is stored: it returns `""`, the empty default, and the caller sees
 * nothing to compare against. `getAllInternalSettings` passes internal values through verbatim, which is
 * what a bcrypt hash needs.
 *
 * The failure mode this caused was nasty, because it was silent and looked like the wrong PIN rather than
 * a broken reader: every role's hash came back empty, the loop fell through, and the login route answered
 * "That PIN isn't right." for a PIN that was perfectly correct. Nothing in the database was wrong and no
 * hash was ever compared, so there was no audit trail to follow -- the only symptom was that no PIN in
 * the church worked, including ones known to be right.
 */
export async function resolveRoleFromPin(rawPin: string): Promise<Role | null> {
  const pin = rawPin.trim();
  if (pin.length < 4 || pin.length > 12) return null;

  const settings = await getAllInternalSettings();

  const roles: Role[] = ["admin", "secretary", "member", "officer", "treasurer", "super_admin"];
  for (const role of roles) {
    const hash = settings[PIN_KEYS[role]];
    if (hash && bcrypt.compareSync(pin, hash)) return role;
  }
  return null;
}
