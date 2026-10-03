import { describe, expect, it } from "vitest";
import {
  EXPOSED_KEYS,
  SETTING_DEFINITIONS,
  SETTINGS_BY_KEY,
  SETTING_KEYS,
  SETTING_SECTIONS,
  labelFor,
  parseSetting,
  settingsBySection,
  validateSetting,
  validateSettings,
} from "./registry";

describe("the registry", () => {
  it("has no duplicate keys", () => {
    // A duplicated key would silently shadow itself in the map, and one of the two validators would be
    // the one that never runs.
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const key of SETTING_KEYS) {
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });

  it("has a default and a description for every key", () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.default, definition.key).toBeTypeOf("string");
      expect(definition.description.length, definition.key).toBeGreaterThan(0);
      expect(definition.usedBy.length, definition.key).toBeGreaterThan(0);
    }
  });

  it("marks every PIN hash and session timestamp as internal", () => {
    for (const role of ["admin", "secretary", "member", "officer", "treasurer", "super_admin"]) {
      expect(SETTINGS_BY_KEY.get(`pin_${role}_hash`)?.exposed, role).toBe(false);
      expect(SETTINGS_BY_KEY.get(`sessions_valid_after_${role}`)?.exposed, role).toBe(false);
    }
  });

  it("exposes the keys the spec lists, and only those, for editing", () => {
    const exposed = EXPOSED_KEYS.map((d) => d.key);
    for (const key of [
      "church_name",
      "church_address",
      "report_title",
      "report_timezone",
      "attendance_auto_approve_appeals",
      "appeal_window_days",
      "appeal_retention_months",
      "auto_create_sunday_sessions",
      "archive_on_generate",
      "audit_retention_months",
    ]) {
      expect(exposed, key).toContain(key);
    }
    // No PIN hash may ever appear on the settings page.
    expect(exposed.filter((k) => k.startsWith("pin_"))).toEqual([]);
    expect(exposed.filter((k) => k.startsWith("sessions_valid_after_"))).toEqual([]);
  });

  it("puts every exposed key in a section that has a title", () => {
    const sectionIds = SETTING_SECTIONS.map((s) => s.id);
    for (const definition of EXPOSED_KEYS) {
      expect(sectionIds, definition.key).toContain(definition.section);
    }
  });

  it("defaults the super admin to requiring an actor name and a member to not", () => {
    // Staff sign in on a shared device; a member signs in on their own phone.
    expect(SETTINGS_BY_KEY.get("require_actor_name_super_admin")?.default).toBe("true");
    expect(SETTINGS_BY_KEY.get("require_actor_name_member")?.default).toBe("false");
  });

  it("has a default timezone of Asia/Manila", () => {
    expect(SETTINGS_BY_KEY.get("report_timezone")?.default).toBe("Asia/Manila");
  });

  it("groups keys into the sections the settings page renders", () => {
    expect(settingsBySection("identity").map((d) => d.key)).toContain("church_name");
    expect(settingsBySection("time").map((d) => d.key)).toContain("report_timezone");
    expect(settingsBySection("data").map((d) => d.key)).toContain("appeal_retention_months");
  });

  it("labels keys readably for error messages", () => {
    expect(labelFor(SETTINGS_BY_KEY.get("church_name")!)).toBe("Church Name");
    expect(labelFor(SETTINGS_BY_KEY.get("report_timezone")!)).toBe("Report Timezone");
  });
});

// ======================================================================================
// validateSetting
// ======================================================================================

describe("validateSetting", () => {
  it("rejects a key that is not registered", () => {
    const result = validateSetting("not_a_setting", "x");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/Unknown setting/);
  });

  it("refuses to write an internal key, by name", () => {
    // Loudly, rather than filtering silently: a caller that thinks it can set a PIN hash here is a bug,
    // and a quiet "no" hides it until somebody tries to use the value.
    const result = validateSetting("pin_admin_hash", "$2b$10$whatever");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/managed elsewhere/);
  });

  it("refuses to write a session timestamp", () => {
    expect(validateSetting("sessions_valid_after_admin", "2026-01-01").ok).toBe(false);
  });

  it("trims strings", () => {
    const result = validateSetting("church_name", "  Knights of the Altar  ");
    expect(result).toEqual({ ok: true, value: "Knights of the Altar" });
  });

  it("refuses an over-long string", () => {
    const result = validateSetting("church_name", "x".repeat(500));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/200 characters or fewer/);
  });

  it("accepts only true and false for booleans", () => {
    expect(validateSetting("auto_create_sunday_sessions", "true").ok).toBe(true);
    expect(validateSetting("auto_create_sunday_sessions", "false").ok).toBe(true);
    expect(validateSetting("auto_create_sunday_sessions", "1").ok).toBe(false);
    expect(validateSetting("auto_create_sunday_sessions", "yes").ok).toBe(false);
    expect(validateSetting("auto_create_sunday_sessions", "TRUE").ok).toBe(false);
  });

  it("accepts only whole numbers for integers", () => {
    expect(validateSetting("appeal_window_days", "21").ok).toBe(true);
    expect(validateSetting("appeal_window_days", "21.5").ok).toBe(false);
    expect(validateSetting("appeal_window_days", "-1").ok).toBe(false);
    expect(validateSetting("appeal_window_days", "twelve").ok).toBe(false);
  });

  it("enforces integer ranges", () => {
    expect(validateSetting("appeal_window_days", "0").ok).toBe(true);
    expect(validateSetting("appeal_window_days", "365").ok).toBe(true);
    expect(validateSetting("appeal_window_days", "366").ok).toBe(false);

    expect(validateSetting("audit_retention_months", "1").ok).toBe(true);
    expect(validateSetting("audit_retention_months", "120").ok).toBe(true);
    expect(validateSetting("audit_retention_months", "0").ok).toBe(false);
    expect(validateSetting("audit_retention_months", "121").ok).toBe(false);
  });

  it("accepts a real IANA timezone and refuses anything else", () => {
    // Spec §9: an invalid timezone is impossible to save.
    expect(validateSetting("report_timezone", "Asia/Manila").ok).toBe(true);
    expect(validateSetting("report_timezone", "Europe/Madrid").ok).toBe(true);
    expect(validateSetting("report_timezone", "UTC").ok).toBe(true);

    expect(validateSetting("report_timezone", "Mars/Olympus").ok).toBe(false);
    expect(validateSetting("report_timezone", "Asia/Manilaa").ok).toBe(false);
    expect(validateSetting("report_timezone", "PST").ok).toBe(false);
    expect(validateSetting("report_timezone", "").ok).toBe(false);
  });

  it("refuses a non-string value", () => {
    expect(validateSetting("church_name", 42).ok).toBe(false);
    expect(validateSetting("church_name", null).ok).toBe(false);
    expect(validateSetting("church_name", true).ok).toBe(false);
  });
});

// ======================================================================================
// validateSettings
// ======================================================================================

describe("validateSettings", () => {
  it("accepts a valid batch", () => {
    const result = validateSettings({ church_name: "St. Mary", audit_retention_months: "24" });
    expect(result).toEqual({ ok: true, values: { church_name: "St. Mary", audit_retention_months: "24" } });
  });

  it("is all-or-nothing", () => {
    // Saving two of three and reporting success is how a form ends up telling the user "Saved" while the
    // page behaves as though they never pressed it.
    const result = validateSettings({ church_name: "St. Mary", report_timezone: "Nope/Nope" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.report_timezone).toBeTruthy();
  });

  it("reports every failing key, not just the first", () => {
    const result = validateSettings({ report_timezone: "bad", audit_retention_months: "0" });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(Object.keys(result.errors).sort()).toEqual(["audit_retention_months", "report_timezone"]);
    }
  });

  it("refuses an empty patch", () => {
    const result = validateSettings({});
    expect(result.ok).toBe(false);
  });

  it("refuses a patch of only unknown keys", () => {
    expect(validateSettings({ nope: "1" }).ok).toBe(false);
  });
});

// ======================================================================================
// parseSetting: the read-side fallback
// ======================================================================================

describe("parseSetting", () => {
  it("returns the stored value when it is valid", () => {
    expect(parseSetting("church_name", "St. Mary")).toBe("St. Mary");
  });

  it("returns the default when the row is missing", () => {
    // Spec §8: a missing setting row returns the registry default.
    expect(parseSetting("church_name", null)).toBe("Knights of the Altar");
    expect(parseSetting("report_timezone", undefined)).toBe("Asia/Manila");
    expect(parseSetting("audit_retention_months", null)).toBe("12");
  });

  it("falls back rather than propagating an invalid stored value", () => {
    // Spec §8: an old row with a bad value shows red on the health page, and the app keeps working.
    expect(parseSetting("report_timezone", "Mars/Olympus")).toBe("Asia/Manila");
    expect(parseSetting("audit_retention_months", "9999")).toBe("12");
    expect(parseSetting("auto_create_sunday_sessions", "maybe")).toBe("true");
  });

  it("passes an unregistered key straight through", () => {
    expect(parseSetting("who_knows", "value")).toBe("value");
  });

  it("keeps an empty string for a string setting, because empty is a real value", () => {
    expect(parseSetting("church_address", "")).toBe("");
  });
});