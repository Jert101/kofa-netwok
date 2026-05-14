import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SettingKey } from "./keys";

export async function getAllSettings(): Promise<Record<string, string>> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("system_settings").select("key, value");
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    out[row.key] = row.value;
  }
  return out;
}

export async function getSetting(key: SettingKey): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("system_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function upsertSettings(pairs: Partial<Record<SettingKey, string>>) {
  const sb = getSupabaseAdmin();
  const rows = Object.entries(pairs).map(([key, value]) => ({
    key,
    value: value as string,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await sb.from("system_settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}
