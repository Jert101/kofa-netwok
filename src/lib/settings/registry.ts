/**
 * SYS-2: the settings registry.
 *
 * Before this file, every setting was a bare string key with its type implied by whichever module read
 * it: `(await getSetting("auto_create_sunday_sessions")) === "true"` in the cron, `parseInt` in the
 * sweep, free text in the settings form. A typo in a key was a silent `null`, and an invalid value in
 * the database was a page that 500s somewhere unrelated.
 *
 * So every key now declares its type, its default, a validator, what uses it, and which section of the
 * settings page it belongs to. `getSetting` returns the typed value and falls back to the declared
 * default when the row is missing or holds something invalid.
 *
 * ## Two kinds of key
 *
 * `exposed: true` keys are editable through `PATCH /api/admin/settings` and appear on the settings
 * page. `exposed: false` keys are PIN hashes and session-revocation timestamps: they live in the same
 * table, they are managed only by module 02's PIN endpoints, and they are **never** returned by the
 * settings API or included in a backup. Putting them in this registry rather than hard-coding them
 * elsewhere is what makes that exhaustible -- a key that is not in the registry cannot be written by
 * the settings API at all.
 */

import { isValidTimeZone } from "@/lib/time/church-time";

export type SettingType = "string" | "boolean" | "integer" | "timezone";

export type SettingSection =
  | "identity"
  | "time"
  | "attendance"
  | "reports"
  | "security"
  | "data";

export type SettingDefinition = {
  key: string;
  type: SettingType;
  /** What `getSetting` returns when the row is missing or invalid. */
  default: string;
  /** Whether the settings API may write it. False for PIN hashes and session timestamps. */
  exposed: boolean;
  section: SettingSection;
  /** Shown on the settings page as help text. */
  description: string;
  /** Which module reads it. */
  usedBy: string;
  /** Optional bounds for integers. */
  min?: number;
  max?: number;
  /** Optional cap on string length. */
  maxLength?: number;
};

function def(
  key: string,
  type: SettingType,
  dflt: string,
  section: SettingSection,
  description: string,
  usedBy: string,
  extra: Partial<SettingDefinition> = {},
): SettingDefinition {
  return { key, type, default: dflt, exposed: true, section, description, usedBy, ...extra };
}

/** Not editable here, and never returned by the settings API. */
function internal(
  key: string,
  description: string,
  usedBy: string,
  extra: Partial<SettingDefinition> = {},
): SettingDefinition {
  return {
    key,
    type: "string",
    default: "",
    exposed: false,
    section: "security",
    description,
    usedBy,
    ...extra,
  };
}

const ROLES = ["admin", "secretary", "member", "officer", "treasurer", "super_admin"] as const;

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  // ---- Church identity -----------------------------------------------------------------
  def("church_name", "string", "Knights of the Altar", "identity",
    "Appears on every report and PDF header.", "Reports, PDFs", { maxLength: 200 }),
  def("church_address", "string", "", "identity",
    "Appears under the church name on printed reports.", "Reports, PDFs", { maxLength: 300 }),
  def("report_title", "string", "Monthly Attendance Report", "identity",
    "The heading on the generated report.", "Reports", { maxLength: 200 }),

  // ---- Time ------------------------------------------------------------------------------
  def("report_timezone", "timezone", "Asia/Manila", "time",
    "Decides when reports open and where 'today' starts. Changing it moves every date rule in the app.",
    "All date rules"),

  // ---- Attendance ------------------------------------------------------------------------
  def("auto_create_sunday_sessions", "boolean", "true", "attendance",
    "The weekly cron pre-creates Sunday's sessions so the secretary opens the week ready.",
    "Attendance (ATT-2 cron)"),
  def("attendance_auto_approve_appeals", "boolean", "false", "attendance",
    "An appeal adds attendance automatically instead of waiting for an answer. Only switch this on if " +
    "somebody reviews the appeals anyway.",
    "Appeals (APL-6)"),
  def("appeal_window_days", "integer", "14", "attendance",
    "Days after a Mass during which an appeal is accepted. 0 means no limit.", "Appeals (APL-1)",
    { min: 0, max: 365 }),

  // ---- Reports ---------------------------------------------------------------------------
  def(
    "archive_on_generate",
    "boolean",
    "true",
    "reports",
    "Move the month's attendance into the archive when its report is generated. Turn this off to keep " +
    "working on a month after generating, and archive it by hand later.",
    "Reports (RPT-2)",
  ),

  // ---- Security --------------------------------------------------------------------------
  def("audit_retention_months", "integer", "12", "security",
    "How many months of audit history to keep before the sweep removes it.", "Sweep (AUTH-8)",
    { min: 1, max: 120 }),
  ...ROLES.map((role) =>
    def(`require_actor_name_${role}`, "boolean", role === "member" ? "false" : "true", "security",
      `Ask who is using the device before letting them in as ${role}.`,
      "Auth (AUTH-4)"),
  ),

  // ---- Data ------------------------------------------------------------------------------
  def("appeal_retention_months", "integer", "12", "data",
    "How many months of resolved appeals to keep. Pending appeals are never swept.",
    "Sweep (APL-3)", { min: 1, max: 120 }),

  // ---- Internal, module 02 only -----------------------------------------------------------
  ...ROLES.map((role) => internal(`pin_${role}_hash`, `The ${role} sign-in PIN, as a bcrypt hash.`,
    "Auth (AUTH-1), written only by /api/admin/pins")),
  ...ROLES.map((role) =>
    internal(`sessions_valid_after_${role}`,
      `Sessions signed in as ${role} before this instant are rejected.`, "Auth (AUTH-5)"),
  ),
];

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTING_DEFINITIONS.map((d) => [d.key, d]),
);

export const SETTING_KEYS: readonly string[] = SETTING_DEFINITIONS.map((d) => d.key);

/** The keys the settings page shows, grouped by section, in display order. */
export const EXPOSED_KEYS: readonly SettingDefinition[] = SETTING_DEFINITIONS.filter((d) => d.exposed);

export function settingsBySection(section: SettingSection): SettingDefinition[] {
  return EXPOSED_KEYS.filter((d) => d.section === section);
}

// ======================================================================================
// Validation
// ======================================================================================

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

/**
 * Validate one value against one definition, and return the string that should be stored.
 *
 * Returns the *stored* string rather than a parsed value because `system_settings.value` is a text
 * column, and a boolean is stored as "true"/"false" so it reads the same way in the table as it does in
 * the settings form.
 */
export function validateSetting(key: string, raw: unknown): ValidationResult {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) return { ok: false, message: `Unknown setting: ${key}` };
  if (!definition.exposed) {
    // Refusing here rather than filtering silently is deliberate: a caller that thinks it can write a PIN
    // hash through this path is a bug, and a quiet "no" hides it.
    return { ok: false, message: `${key} is managed elsewhere and cannot be set here.` };
  }

  if (typeof raw !== "string") return { ok: false, message: `${definition.key} must be text.` };
  const value = raw.trim();

  switch (definition.type) {
    case "string": {
      const max = definition.maxLength ?? 1000;
      if (value.length > max) {
        return { ok: false, message: `${labelFor(definition)} must be ${max} characters or fewer.` };
      }
      return { ok: true, value };
    }

    case "boolean": {
      if (value !== "true" && value !== "false") {
        return { ok: false, message: `${labelFor(definition)} must be true or false.` };
      }
      return { ok: true, value };
    }

    case "integer": {
      if (!/^\d+$/.test(value)) {
        return { ok: false, message: `${labelFor(definition)} must be a whole number.` };
      }
      const n = Number(value);
      const min = definition.min ?? 0;
      const max = definition.max ?? 1000;
      if (n < min || n > max) {
        return { ok: false, message: `${labelFor(definition)} must be between ${min} and ${max}.` };
      }
      return { ok: true, value: String(n) };
    }

    case "timezone": {
      if (!isValidTimeZone(value)) {
        // Spec §9: "An invalid timezone is impossible to save." This is where that is enforced, and it
        // is enforced on write rather than on read, because a page that quietly falls back to Manila is
        // a page where nobody finds out their timezone is wrong until a report opens on the wrong day.
        return {
          ok: false,
          message: "That is not a recognised timezone. Use an IANA name such as Asia/Manila.",
        };
      }
      return { ok: true, value };
    }
  }
}

/**
 * Validate a whole batch, returning the values to store and every message.
 *
 * All-or-nothing on purpose: saving three settings and silently dropping the one that failed is how a
 * form ends up telling the user "Saved" while the page behaves as though they never pressed it.
 */
export function validateSettings(
  patch: Record<string, unknown>,
): { ok: true; values: Record<string, string> } | { ok: false; errors: Record<string, string> } {
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};

  for (const [key, raw] of Object.entries(patch)) {
    const result = validateSetting(key, raw);
    if (result.ok) values[key] = result.value;
    else errors[key] = result.message;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(values).length === 0) return { ok: false, errors: { _form: "Nothing to change." } };
  return { ok: true, values };
}

/** The typed value of a setting, falling back to the declared default. */
export function parseSetting(key: string, raw: string | null | undefined): string {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) return raw ?? "";
  if (raw === null || raw === undefined) return definition.default;

  // An invalid stored value falls back rather than propagating. Spec §8: "An old row with an invalid
  // value... the health page shows red, and the app falls back to Asia/Manila rather than failing."
  const result = validateSetting(key, raw);
  return result.ok ? result.value : definition.default;
}

/** A boolean setting, for the `=== "true"` comparison written all over the app. */
export function parseSettingBoolean(key: string, raw: string | null | undefined): boolean {
  return parseSetting(key, raw) === "true";
}

/** An integer setting, clamped to the declared range. */
export function parseSettingInteger(key: string, raw: string | null | undefined): number {
  const value = parseSetting(key, raw);
  const n = Number(value);
  return Number.isFinite(n) ? n : Number(SETTINGS_BY_KEY.get(key)?.default ?? 0);
}

/** A human label for a key, for error messages. */
export function labelFor(definition: SettingDefinition): string {
  return definition.key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Every section in display order, so the settings page and the API agree on the grouping. */
export const SETTING_SECTIONS: readonly { id: SettingSection; title: string; blurb: string }[] = [
  { id: "identity", title: "Church identity", blurb: "What appears at the top of every report." },
  { id: "time", title: "Time", blurb: "Where today starts." },
  { id: "attendance", title: "Attendance", blurb: "Weekend sessions and appeals." },
  { id: "reports", title: "Reports", blurb: "What the monthly report says about itself." },
  { id: "security", title: "Security", blurb: "Who must say who they are." },
  { id: "data", title: "Data", blurb: "How long things are kept." },
];