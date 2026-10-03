// Verifies that every PostgREST embed in src/ resolves against the live database.
//
// ## Why this exists
//
// Three separate features were fully broken by this one mistake, and no existing gate noticed any of
// them:
//
//   1. `loadRoster` embedded `attendance_sessions_archive!inner(session_date)`. That relationship
//      cannot exist -- `attendance_records_archive.session_id` has no foreign key, because the archive
//      is keyed on `(id, archived_at)`. Every attendance session screen 500'd with an empty body.
//   2. `pendingItemsForSession` embedded `attendance_appeals!inner(..., members!inner(full_name))`.
//      An appeal header is per Mass and carries only a note; the member lives on the item. The
//      per-session appeals panel rendered its empty state for Masses that had appeals waiting.
//   3. Three payments routes embedded a bare `members(full_name)`. `payments` has three foreign keys to
//      `members` (`member_id`, `recorded_by_member_id`, `voided_by_member_id`), so the embed was
//      ambiguous and PostgREST refused it -- including on the void endpoint, where every attempt failed
//      with "Could not load that payment."
//
// `tsc`, ESLint and all unit tests were green throughout, because none of them perform a real request
// and none of them know anything about the database schema. An embed is a string, so a typo in it is
// invisible until runtime -- and the failure mode is usually a screen that renders empty or an error
// nobody can explain, rather than a loud crash.
//
// ## What it checks
//
// Finds each `.from("table")` ... `.select("...")` pair in src/ and replays the select against PostgREST
// with `limit=1`. Column lists are skipped, since those cannot fail on relationships. Selects built from
// a variable or a template literal are reported as unchecked, so it is obvious that the list is not
// exhaustive rather than silently reassuring.
//
// ## Running it
//
//     npm run check:embeds
//
// Needs `.env.local` with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and network access.
// Exits non-zero when anything is broken, so it is safe to wire into a pre-deploy step.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function loadEnv(file) {
  const env = {};
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = { ...loadEnv(".env.local"), ...loadEnv(".env") };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local / .env.\n" +
      "This check talks to the real database, so it cannot run without them.",
  );
  process.exit(2);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// Tests are excluded: they assert on the string a query was built with, not on whether the database can
// satisfy it, so including them would only add noise.
const files = walk("src").filter((f) => !/\.(test|spec)\./.test(f) && !f.includes("__tests__"));

const embeds = new Map();
const unchecked = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const from = /\.from\(\s*"([a-z_][a-z0-9_]*)"\s*\)/.exec(lines[i]);
    if (!from) continue;

    // The chain usually wraps onto the next few lines, so look ahead rather than at this line only.
    const window = lines.slice(i, i + 4).join(" ");
    const select = /\.select\(\s*"([^"]+)"/.exec(window);

    if (!select) {
      if (/\.select\(/.test(window)) {
        unchecked.push(`${file}:${i + 1}  ${window.trim().slice(0, 100)}`);
      }
      continue;
    }

    // No parentheses means a plain column list, which cannot fail on a missing relationship.
    if (!select[1].includes("(")) continue;

    const key = `${from[1]}|${select[1]}`;
    if (!embeds.has(key)) embeds.set(key, `${file.replace(/\\/g, "/")}:${i + 1}`);
  }
}

console.log(`Checking ${embeds.size} embeds across ${files.length} files.\n`);

const broken = [];

for (const [combo, where] of embeds) {
  const [table, select] = combo.split("|");
  const res = await fetch(
    `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (res.ok) continue;

  const body = await res.text();

  // PGRST205 means the table itself is absent, which is a migration problem, not an embed problem.
  // The health page reports missing tables; do not double-count them here.
  if (res.status === 404 || body.includes("PGRST205")) {
    console.log(`  no such table   ${table}  (${where})`);
    continue;
  }

  broken.push({ where, table, select, status: res.status, body });
}

for (const b of broken) {
  console.log(`  BROKEN  ${b.status}  ${b.where}`);
  console.log(`          .from("${b.table}")`);
  console.log(`          .select("${b.select}")`);
  console.log(`          ${b.body.slice(0, 400)}`);
  console.log("");
}

if (unchecked.length) {
  console.log(`Not checked, because the select is built at runtime (${unchecked.length}):`);
  for (const u of unchecked) console.log(`  ${u}`);
  console.log("");
}

if (broken.length === 0) {
  console.log("Every embed resolves.");
  process.exit(0);
}

console.log(
  `${broken.length} embed(s) cannot be satisfied. Each one is a screen that will fail at runtime ` +
    `with no error until someone opens it.`,
);
process.exit(1);
