/**
 * Seeds March weekend attendance_sessions (no attendance_records):
 * - Each Saturday: Anticipated Mass
 * - Each Sunday: First Mass, Second Mass, Third Mass, Fourth Mass
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local or env.
 * Optional: SEED_MARCH_YEAR=2026
 *
 * Idempotent: removes prior rows with notes = SEED_MARCH_WEEKEND for that March, then inserts.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const SEED_NOTE = "SEED_MARCH_WEEKEND";

function loadEnvLocal() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const year = parseInt(process.env.SEED_MARCH_YEAR || "2026", 10);

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const MASSES = [
  "Anticipated Mass",
  "First Mass",
  "Second Mass",
  "Third Mass",
  "Fourth Mass",
];

async function ensureMasses() {
  for (const name of MASSES) {
    const { data: rows } = await sb.from("masses").select("id").eq("name", name).limit(1);
    if (rows?.length) continue;
    const { error } = await sb.from("masses").insert({
      name,
      default_sunday: false,
      is_active: true,
    });
    if (error) throw new Error(`Insert mass ${name}: ${error.message}`);
  }
  const { data, error } = await sb.from("masses").select("id, name").in("name", MASSES);
  if (error) throw error;
  const map = new Map();
  for (const row of data ?? []) map.set(row.name, row.id);
  for (const name of MASSES) {
    if (!map.has(name)) throw new Error(`Missing mass row: ${name}`);
  }
  return map;
}

function marchDates(year) {
  const out = [];
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, 2, day);
    if (d.getMonth() !== 2) break;
    out.push(d);
  }
  return out;
}

async function main() {
  const byName = await ensureMasses();

  const { data: toRemove, error: qErr } = await sb
    .from("attendance_sessions")
    .select("id")
    .eq("notes", SEED_NOTE)
    .gte("session_date", `${year}-03-01`)
    .lte("session_date", `${year}-03-31`);
  if (qErr) throw qErr;
  const ids = (toRemove ?? []).map((r) => r.id);
  if (ids.length) {
    const { error: delErr } = await sb.from("attendance_sessions").delete().in("id", ids);
    if (delErr) throw delErr;
    console.log(`Removed ${ids.length} previous seed session(s).`);
  }

  const rows = [];
  for (const d of marchDates(year)) {
    const dow = d.getDay();
    const ymd = d.toISOString().slice(0, 10);
    if (dow === 6) {
      rows.push({
        session_date: ymd,
        mass_id: byName.get("Anticipated Mass"),
        notes: SEED_NOTE,
      });
    } else if (dow === 0) {
      for (const label of ["First Mass", "Second Mass", "Third Mass", "Fourth Mass"]) {
        rows.push({
          session_date: ymd,
          mass_id: byName.get(label),
          notes: SEED_NOTE,
        });
      }
    }
  }

  if (rows.length) {
    const { error: insErr } = await sb.from("attendance_sessions").insert(rows);
    if (insErr) throw insErr;
  }

  console.log(`Seeded ${rows.length} session(s) for March ${year} (${SEED_NOTE}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
