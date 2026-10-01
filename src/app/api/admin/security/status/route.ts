import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { findRolesOnDefaultPin, findRolesSharingAStoredHash, countPendingReports, PIN_HASH_KEY, ROLES } from "@/lib/auth/pin-service";
import { getAllSettings, getSettingsUpdatedAt } from "@/lib/settings/store";
import { SESSIONS_VALID_AFTER_KEY } from "@/lib/auth/session-valid";
import { DEFAULT_PIN } from "@/lib/auth/pin-rules";

export const dynamic = "force-dynamic";

/** AUTH-6 backing data: which roles are unsafe, duplicated, or revoked. */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  try {
    const settings = await getAllSettings();
    const defaults = await findRolesOnDefaultPin();
    const sharedHash = findRolesSharingAStoredHash(settings);
    const changedAt = await getSettingsUpdatedAt(ROLES.map((r) => PIN_HASH_KEY[r]));

    const roles = ROLES.map((role) => ({
      role,
      hasPin: Boolean(settings[PIN_HASH_KEY[role]]),
      pinChangedAt: changedAt[PIN_HASH_KEY[role]] ?? null,
      sessionsValidAfter: settings[SESSIONS_VALID_AFTER_KEY[role]] ?? null,
      onDefaultPin: defaults.includes(role),
    }));

    return jsonOk({
      defaultPin: DEFAULT_PIN,
      rolesOnDefaultPin: defaults,
      sharedHash,
      pendingReports: await countPendingReports(),
      roles,
    });
  } catch (e) {
    console.error("[security/status] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
