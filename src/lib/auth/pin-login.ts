import bcrypt from "bcryptjs";
import { getSetting } from "@/lib/settings/store";
import type { Role } from "./roles";

const PIN_KEYS: Record<
  Role,
  "pin_admin_hash" | "pin_secretary_hash" | "pin_member_hash" | "pin_officer_hash"
> = {
  admin: "pin_admin_hash",
  secretary: "pin_secretary_hash",
  member: "pin_member_hash",
  officer: "pin_officer_hash",
};

export async function resolveRoleFromPin(rawPin: string): Promise<Role | null> {
  const pin = rawPin.trim();
  if (pin.length < 4 || pin.length > 12) return null;

  const roles: Role[] = ["admin", "secretary", "member", "officer"];
  for (const role of roles) {
    const hash = await getSetting(PIN_KEYS[role]);
    if (hash && bcrypt.compareSync(pin, hash)) return role;
  }
  return null;
}
