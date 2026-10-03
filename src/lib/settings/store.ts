import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  parseSetting,
  SETTINGS_BY_KEY,
  validateSetting,
  type SettingDefinition,
} from "./registry";

/**
 * SYS-2: the only way anything reads settings.
 *
 * Spec §9: "Nothing reads settings except through `getSetting`." Before this module the table was read
 * in four places with four different ideas of what an unparseable value meant, and the settings API had
 * its own hand-written zod schema that had drifted from what the callers actually checked.
 *
 * Now a key that is not in the registry cannot be read through here, cannot be written through the
 * settings API, and does not appear on the settings page. That is what makes the set exhaustible rather
 * than a list that has to be kept in step by hand.
 */

/**
 * One row's value, parsed against the registry, falling back to the declared default.
 *
 * Returns the raw string rather than a parsed JS value because every existing caller compares against
 * `"true"` or `"12"`, and changing all of them at once would be a large diff for no benefit. The typed
 * helpers below cover new code.
 */
export async function getSetting(key: string): Promise<string> {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) {
    // A typo in a key used to return null and quietly take a `=== "true"` branch the wrong way. Saying
    // so loudly is the fix, and it is a bug in the calling code either way.
    throw new Error(`getSetting: "${key}" is not a registered setting.`);
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("system_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;

  return parseSetting(key, data?.value ?? null);
}

/** As `getSetting`, but never throws. For a cron or a dashboard where one bad key must not 500 the page. */
export async function tryGetSetting(key: string): Promise<string | null> {
  try {
    return await getSetting(key);
  } catch (e) {
    console.error(`[settings] could not read "${key}":`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** A boolean setting. */
export async function getBooleanSetting(key: string): Promise<boolean> {
  return (await getSetting(key)) === "true";
}

/** An integer setting, already range-checked by the registry. */
export async function getIntegerSetting(key: string): Promise<number> {
  const n = Number(await getSetting(key));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Every registered setting's effective value.
 *
 * Exposed keys only. The PIN hashes and session timestamps live in the same table and are never
 * returned by any endpoint, so a caller cannot accidentally build a settings export that includes them.
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("system_settings").select("key, value");
  if (error) throw error;

  const stored = new Map<string, string>();
  for (const row of data ?? []) stored.set(String(row.key), String(row.value ?? ""));

  const out: Record<string, string> = {};
  for (const [key, definition] of SETTINGS_BY_KEY) {
    if (!definition.exposed) continue;
    out[key] = parseSetting(key, stored.get(key) ?? null);
  }
  return out;
}

/**
 * The values of specific keys, for a page that needs three of them.
 *
 * Only exposed keys are returned, even if an internal key is asked for by name -- so a future caller
 * cannot use this to read a PIN hash by passing its key.
 */
export async function getSettings(keys: readonly string[]): Promise<Record<string, string>> {
  const sb = getSupabaseAdmin();
  const allowed = keys.filter((k) => SETTINGS_BY_KEY.get(k)?.exposed);
  if (allowed.length === 0) return {};

  const { data, error } = await sb.from("system_settings").select("key, value").in("key", allowed);
  if (error) throw error;

  const stored = new Map<string, string>();
  for (const row of data ?? []) stored.set(String(row.key), String(row.value ?? ""));

  const out: Record<string, string> = {};
  for (const key of allowed) out[key] = parseSetting(key, stored.get(key) ?? null);
  return out;
}

/**
 * Every registered setting's effective value, **including** the internal ones.
 *
 * PIN hashes and session-revocation timestamps only. Exists for module 02's four call sites and for the
 * report generator's super-admin check, and named to make the difference from `getAllSettings` obvious at
 * the call site -- reading a PIN hash out of the general-purpose reader is how a hash ends up in a
 * settings export.
 */
export async function getAllInternalSettings(): Promise<Record<string, string>> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("system_settings").select("key, value");
  if (error) throw error;

  const stored = new Map<string, string>();
  for (const row of data ?? []) stored.set(String(row.key), String(row.value ?? ""));

  const out: Record<string, string> = {};
  for (const [key, definition] of SETTINGS_BY_KEY) {
    if (definition.exposed) continue;
    // Internal values are passed through verbatim: a PIN hash is a hash, and validating it against a
    // string rule would be meaningless. A missing row becomes the declared empty default.
    out[key] = stored.get(key) ?? definition.default;
  }
  return out;
}

/**
 * One internal value.
 *
 * For `pin_super_admin_hash`, which is also the flag for whether the approval workflow is switched on.
 * Reading it through `getSetting` would apply a registry default and hide the fact that an empty string
 * is a meaningful value rather than a missing one.
 */
export async function getInternalSetting(key: string): Promise<string> {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition || definition.exposed) {
    throw new Error(`getInternalSetting: "${key}" is not an internal setting.`);
  }
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("system_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value ?? definition.default;
}

/**
 * Last-modified timestamps for internal keys.
 *
 * Separate from `getSettingsUpdatedAt` because the Security page asks "when did this PIN last change",
 * and filtering internal keys out of the general reader would answer "never" for all six roles.
 */
export async function getInternalSettingsUpdatedAt(
  keys: readonly string[],
): Promise<Record<string, string>> {
  const sb = getSupabaseAdmin();
  const allowed = keys.filter((k) => {
    const definition = SETTINGS_BY_KEY.get(k);
    return Boolean(definition) && !definition!.exposed;
  });
  if (allowed.length === 0) return {};

  const { data, error } = await sb
    .from("system_settings")
    .select("key, updated_at")
    .in("key", allowed);
  if (error) throw error;

  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.updated_at) out[String(row.key)] = String(row.updated_at);
  }
  return out;
}

/** Last-modified timestamps, for the settings page's "changed by" lines. Internal keys excluded. */
export async function getSettingsUpdatedAt(
  keys: readonly string[],
): Promise<Record<string, string>> {
  const sb = getSupabaseAdmin();
  const allowed = keys.filter((k) => SETTINGS_BY_KEY.get(k)?.exposed);
  if (allowed.length === 0) return {};

  const { data, error } = await sb
    .from("system_settings")
    .select("key, updated_at")
    .in("key", allowed);
  if (error) throw error;

  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.updated_at) out[String(row.key)] = String(row.updated_at);
  }
  return out;
}

/**
 * Write settings, validating each one first.
 *
 * All-or-nothing: if any value fails validation nothing is written. A form that saves two of three
 * settings and reports success is worse than one that saves none and says which field is wrong.
 */
export async function upsertSettings(pairs: Record<string, string>): Promise<void> {
  const sb = getSupabaseAdmin();
  const rows: Array<{ key: string; value: string; updated_at: string }> = [];

  for (const [key, value] of Object.entries(pairs)) {
    const result = validateSetting(key, value);
    if (!result.ok) {
      throw new Error(`upsertSettings: ${result.message}`);
    }
    rows.push({ key, value: result.value, updated_at: new Date().toISOString() });
  }

  if (rows.length === 0) return;
  const { error } = await sb.from("system_settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}

/**
 * Write a value for a key that the registry marks as internal.
 *
 * Separate from `upsertSettings` on purpose: PIN hashes and session timestamps must never travel through
 * the settings API's validation path, because that path is reachable from the admin settings page.
 */
export async function upsertInternalSetting(key: string, value: string): Promise<void> {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition || definition.exposed) {
    throw new Error(`upsertInternalSetting: "${key}" is not an internal setting.`);
  }
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("system_settings")
    .upsert([{ key, value, updated_at: new Date().toISOString() }], { onConflict: "key" });
  if (error) throw error;
}

/** Every definition, for the health page's inventory. */
export function definitions(): readonly SettingDefinition[] {
  return [...SETTINGS_BY_KEY.values()];
}