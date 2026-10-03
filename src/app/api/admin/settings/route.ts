import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonError, jsonOk } from "@/lib/api/response";
import { getSettings, getSettingsUpdatedAt, upsertSettings } from "@/lib/settings/store";
import {
  EXPOSED_KEYS,
  SETTING_SECTIONS,
  validateSettings,
} from "@/lib/settings/registry";
import { logAudit } from "@/lib/audit/log-audit";

export const dynamic = "force-dynamic";

/**
 * SYS-2: read and write settings, validated against the registry.
 *
 * ## What changed, and why it matters
 *
 * The old route had its own zod schema listing eight keys, hand-maintained, which had already drifted
 * from what the callers actually checked: `auto_create_sunday_sessions` could not be toggled from the UI
 * because the schema did not know the key existed, and `report_timezone` was free text, so a typo broke
 * every date rule in the app at once.
 *
 * Now the registry is the only list. A key that is not registered cannot be written, and a key the
 * registry marks internal cannot be written at all -- which is what makes "the settings API never returns
 * a PIN hash" a property of the code rather than a promise in a comment.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  try {
    const keys = EXPOSED_KEYS.map((d) => d.key);
    const [values, updatedAt] = await Promise.all([getSettings(keys), getSettingsUpdatedAt(keys)]);

    return jsonOk({
      values,
      updated_at: updatedAt,
      sections: SETTING_SECTIONS,
      definitions: EXPOSED_KEYS,
    });
  } catch (e) {
    console.error("[admin/settings] read failed:", e instanceof Error ? e.message : e);
    return internalError("Could not read the settings.");
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonError("BAD_REQUEST", "Could not read the request.", { status: 400 });
  }

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return jsonError("BAD_REQUEST", "Send an object of settings.", { status: 400 });
  }

  // Reject anything that is not already a string. Accepting a number here and coercing it would make
  // `church_name: 123` a valid request, and the stored value would then read back as the string "123" on
  // the next load, which is a confusing way to lose a character.
  const raw = json as Record<string, unknown>;
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      return jsonError("VALIDATION_FAILED", `${key} must be sent as text.`, {
        status: 400,
        fields: { [key]: "Must be text." },
      });
    }
    patch[key] = value;
  }

  const validated = validateSettings(patch);
  if (!validated.ok) {
    // All-or-nothing, and every failure named. Saving some of a form and reporting success is worse than
    // saving none and saying which field is wrong.
    return jsonError("VALIDATION_FAILED", "Some settings could not be saved.", {
      status: 400,
      fields: validated.errors,
    });
  }

  try {
    // Read the old values first, so the audit row records what changed rather than only what it became.
    const before = await getSettings(Object.keys(validated.values));

    await upsertSettings(validated.values);

    const changed: Record<string, { from: string; to: string; warning?: string }> = {};
    for (const [key, next] of Object.entries(validated.values)) {
      const previous = before[key] ?? "";
      if (previous !== next) changed[key] = { from: previous, to: next };
    }

    // The timezone warning is not decoration. Spec §7 asks for it because changing it moves when reports
    // open and when "today" starts, everywhere, at once.
    if (changed["report_timezone"]) {
      changed["report_timezone"].warning =
        "This changes when reports open and when 'today' starts. It takes effect immediately.";
    }

    await logAudit({
      actor: {
        role: g.session.role,
        memberId: g.session.actor?.id ?? null,
        name: g.session.actor?.name ?? null,
      },
      action: "settings_updated",
      entityType: "settings",
      entityId: null,
      // Old and new values, per spec §7. Safe for these keys because none of them is a secret: the
      // registry refuses to accept a PIN hash here in the first place.
      meta: { changed },
    });

    return jsonOk({ saved: Object.keys(validated.values), changed });
  } catch (e) {
    console.error("[admin/settings] write failed:", e instanceof Error ? e.message : e);
    return internalError("Could not save the settings.");
  }
}