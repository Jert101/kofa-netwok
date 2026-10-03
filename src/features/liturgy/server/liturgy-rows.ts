import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countUnassigned,
  detectConflicts,
  distinctLabels,
  mergePositionCatalog,
  normaliseSortOrder,
  normalizeLabel,
  summariseConflicts,
  unassignedSummary,
  type LiturgyEntry,
  type LiturgySlotInput,
} from "@/lib/liturgy/rules";

/**
 * The one place liturgy rows are read and written.
 *
 * `liturgy_planned` and `session_liturgy_servers` are structurally identical apart from how
 * they are keyed — (date, mass) versus (session id). The old code had four routes that each
 * repeated the same select, the same delete-then-insert, and the same member validation. This
 * module is the single implementation both key styles go through, so a rule like "save applies
 * to the whole list" or "sort_order is contiguous from 0" cannot hold in one mode and not the
 * other.
 */

export type LiturgyTarget =
  | { kind: "planned"; sessionDate: string; massId: string }
  | { kind: "session"; sessionId: string };

/** The two tables, addressed as data so one implementation can serve both. */
export function tableFor(target: LiturgyTarget): "liturgy_planned" | "session_liturgy_servers" {
  return target.kind === "planned" ? "liturgy_planned" : "session_liturgy_servers";
}

/**
 * Narrow a query to one target.
 *
 * The filter goes *after* the terminal call, because that is the order the PostgREST builder
 * wants: `.from(t).select(cols).eq(...)` and `.from(t).delete().eq(...)` are both valid, while
 * `.from(t).eq(...)` is not. Written out per operation rather than as a generic helper, so the
 * builder's own types stay in charge instead of being re-derived through a type parameter.
 */
function scoped(sb: SupabaseClient, target: LiturgyTarget) {
  const narrowSelect = (columns: string) => {
    const q = sb.from(tableFor(target)).select(columns);
    return target.kind === "planned"
      ? q.eq("session_date", target.sessionDate).eq("mass_id", target.massId)
      : q.eq("session_id", target.sessionId);
  };

  const narrowDelete = () => {
    const q = sb.from(tableFor(target)).delete();
    return target.kind === "planned"
      ? q.eq("session_date", target.sessionDate).eq("mass_id", target.massId)
      : q.eq("session_id", target.sessionId);
  };

  return { select: narrowSelect, delete: narrowDelete };
}

// ======================================================================================
// Reading
// ======================================================================================

export type StoredLiturgyRow = LiturgyEntry & { sort_order: number };

/**
 * The stored version of one group, used to detect a concurrent save.
 *
 * A string rather than a number so it can be either the `revision` column or the row timestamps
 * when 030 has not been applied yet. Callers only ever compare tokens for equality.
 */
export type LiturgyVersion = string;

export type ReadLiturgyResult =
  | { ok: true; rows: StoredLiturgyRow[]; version: LiturgyVersion }
  | { ok: false; code: "NOT_FOUND" | "DB_ERROR"; message: string };

const ROW_COLUMNS =
  "position_label, member_id, free_text, sort_order, updated_at, members(full_name)";

/** One row as PostgREST returns it, before the join is flattened. */
type RawRow = Record<string, unknown>;

export async function readLiturgyRows(
  sb: SupabaseClient,
  target: LiturgyTarget,
): Promise<ReadLiturgyResult> {
  const scope = scoped(sb, target);

  // `revision` was added in 030. It is tried first because it is the intended token; if the
  // column is not there yet the read falls back to `updated_at`, so the module keeps working
  // against a database that has not had the migration run yet.
  const withRevision = await scope.select(ROW_COLUMNS + ", revision").order("sort_order", {
    ascending: true,
  });

  const hasRevision = !withRevision.error;
  const result = hasRevision
    ? withRevision
    : await scope.select(ROW_COLUMNS).order("sort_order", { ascending: true });

  if (result.error) return { ok: false, code: "DB_ERROR", message: result.error.message };

  const raw = (result.data ?? []) as unknown as RawRow[];
  const rows = raw.map((r) => ({
    position_label: String(r.position_label ?? ""),
    member_id: (r.member_id as string | null) ?? null,
    free_text: (r.free_text as string | null) ?? null,
    memberName: memberNameFrom(r.members),
    sort_order: Number(r.sort_order ?? 0),
  })) satisfies StoredLiturgyRow[];

  // With 030 applied the row revision is not asked for at all. It comes from
  // `liturgy_revision_state` instead, because an empty plan has no row to carry a number: a
  // list that went from nine positions to none is exactly the change an officer needs to be told
  // about, and reading max(revision) from zero rows reports 0 for both "never touched" and
  // "just cleared".
  if (hasRevision) {
    const { data, error } = await sb.rpc("liturgy_current_revision", {
      p_target_key: targetKey(target),
    });
    if (!error) return { ok: true, rows, version: `r:${Number(data ?? 0)}` };
    // A missing function means the migration has not been applied yet, which is the same
    // situation the `revision` column probe above handles: fall through to the row token.
  }

  return { ok: true, rows, version: versionToken(raw, hasRevision) };
}

/** The one address both the save function and the revision reader use for a target. */
function targetKey(target: LiturgyTarget): string {
  return target.kind === "planned"
    ? `planned:${target.sessionDate}:${target.massId}`
    : `session:${target.sessionId}`;
}

/**
 * The version of a group is the highest token any row carries.
 *
 * Prefixed rather than bare, because a `revision` number and a timestamp are not comparable:
 * without the prefix "3" sorts above "2026-10-02T09:00:00Z" and the highest revision would
 * lose to the newest timestamp.
 */
function versionToken(raw: RawRow[], hasRevision: boolean): LiturgyVersion {
  if (hasRevision) {
    const highest = raw.reduce((max, r) => Math.max(max, Number(r.revision ?? 0)), 0);
    return `r:${highest}`;
  }
  const newest = raw
    .map((r) => String(r.updated_at ?? ""))
    .filter(Boolean)
    .sort()
    .pop();
  return newest ? `t:${newest}` : "t:none";
}

/**
 * The revision the server should record for this save, as the *expected* revision to hand to the
 * save function.
 *
 * Note what is deliberately not here: the decision of what revision to write. That belongs to
 * `liturgy_save_plan`, which reads the current value and increments it in the same transaction as
 * the delete and insert. Computing it on this side is what made the old three-statement write
 * racy — the version was read, the rows were replaced, and another save could land in between.
 *
 * What this does provide is the value to *compare against*, taken from the caller's token, so the
 * function can answer "did it move under you". A token from before 030 is `t:…` and carries no
 * number; it is passed as NULL, which the function treats as a first save and never calls stale.
 * That is a small loss of the notice on an un-migrated database, and the alternative is guessing
 * a number out of a timestamp and comparing it to a counter.
 */
function expectedRevisionFrom(version: LiturgyVersion | null | undefined): number | null {
  if (!version) return null;
  const m = /^r:(\d+)$/.exec(version);
  return m ? Number(m[1]) : null;
}

// ======================================================================================
// Writing
// ======================================================================================

export type WriteLiturgyResult =
  | {
      ok: true;
      rows: StoredLiturgyRow[];
      version: LiturgyVersion;
      newLabels: string[];
      /** True when the saved rows replaced a version the caller had not seen. */
      updatedByOtherDevice: boolean;
    }
  | {
      ok: false;
      code: "INVALID_MEMBER" | "DB_ERROR";
      message: string;
      inactiveNames?: string[];
    };

/**
 * Replace every row for a target.
 *
 * Three things here are deliberate, and each one replaced something that was quietly wrong:
 *
 * 1. **The save is not blocked by a concurrent edit.** Spec §8 is explicit: "The save returns
 *    the saved rows; the last save wins. Show 'Updated by another device' if the version
 *    changed under you." So a stale version is *reported*, not refused — refusing would be a
 *    different product decision than the one that was specified.
 * 2. **`sort_order` is reassigned from the array index** and never taken from the client, so
 *    the contiguous-from-zero rule holds no matter what the browser sent.
 * 3. **An inactive member is refused only when newly assigned.** Spec §8 also says an
 *    already-assigned inactive member "shows their name with a warning until replaced", which
 *    means re-saving the sheet must keep working. Blocking every save that touches such a row
 *    would make an inactive member impossible to replace, because the officer could not save
 *    the fix without first removing the row that was holding the sheet open.
 */
export async function writeLiturgyRows(
  sb: SupabaseClient,
  target: LiturgyTarget,
  slots: LiturgySlotInput[],
  options: { expectedVersion?: LiturgyVersion | null } = {},
): Promise<WriteLiturgyResult> {
  const clean = normaliseSlotInput(slots);
  // An empty list is a legitimate save, not an error: it clears the plan, which is what
  // `liturgy_cleared` in the audit trail exists to record. Rows whose position label is blank
  // were already dropped above, so this is a deliberate "remove everything", not a malformed
  // payload — the label is what makes a row real, and there is nothing to say here without it.

  // Read before the write for two reasons: which inactive assignments were already there, and
  // as the fallback's version source. Whether the caller's version is stale is *not* decided
  // here — that comparison has to happen inside the same transaction as the replace, or another
  // save can land in between and make the answer wrong.
  const current = await readLiturgyRows(sb, target);
  if (!current.ok) return { ok: false, code: "DB_ERROR", message: current.message };

  const expected = options.expectedVersion ?? null;

  const memberIds = [...new Set(clean.map((s) => s.member_id).filter((id): id is string => !!id))];
  const memberById = new Map<string, { full_name: string; is_active: boolean }>();

  if (memberIds.length > 0) {
    const { data, error } = await sb
      .from("members")
      .select("id, full_name, is_active")
      .in("id", memberIds);
    if (error) return { ok: false, code: "DB_ERROR", message: error.message };

    for (const m of data ?? []) {
      memberById.set(String(m.id), {
        full_name: String(m.full_name ?? ""),
        is_active: m.is_active !== false,
      });
    }

    const unknown = memberIds.filter((id) => !memberById.has(id));
    if (unknown.length > 0) {
      return {
        ok: false,
        code: "INVALID_MEMBER",
        message: "One of the selected members no longer exists. Reload and choose again.",
      };
    }

    // Position -> the members already holding it, normalized, so "crucifix" written differently
    // in the incoming payload still counts as the same position.
    const already = new Map<string, Set<string>>();
    for (const r of current.rows) {
      if (!r.member_id) continue;
      const key = normalizeLabel(r.position_label);
      const set = already.get(key) ?? new Set<string>();
      set.add(r.member_id);
      already.set(key, set);
    }

    const newlyAssigned = new Set<string>();
    for (const s of clean) {
      if (!s.member_id) continue;
      if (memberById.get(s.member_id)?.is_active !== false) continue;
      const key = normalizeLabel(s.position_label);
      if (!already.get(key)?.has(s.member_id)) newlyAssigned.add(s.member_id);
    }

    if (newlyAssigned.size > 0) {
      return {
        ok: false,
        code: "INVALID_MEMBER",
        message: "Only active members can be assigned.",
        inactiveNames: [...newlyAssigned].map((id) => memberById.get(id)!.full_name),
      };
    }
  }

  const [saved, saveErr] = await callSaveFunction(sb, target, clean, expected);

  if (saveErr === "FUNCTION_MISSING") {
    // 030 has not been applied. The old path still works, and still carries the pre-migration
    // limitation of a read-then-replace that cannot see a save landing between the two.
    return legacyWrite(sb, target, clean, current.version);
  }
  if (saveErr) return { ok: false, code: "DB_ERROR", message: saveErr };

  const revision = Number(saved?.revision ?? 0);
  const updatedByOtherDevice = saved?.updated_by_other_device === true;

  const newLabels = await mergeLabelsIntoCatalog(sb, distinctLabels(clean));

  return {
    ok: true,
    version: `r:${revision}`,
    newLabels,
    updatedByOtherDevice,
    // Re-read rather than reconstructing: the function did not echo the rows back, and building
    // them from `clean` would guess at sort_order and at the member names the join provides.
    // One extra read of a group the officer just saved is cheaper than being subtly wrong.
    rows: await reReadRows(sb, target, memberById),
  };
}

/**
 * Ask `liturgy_save_plan` to do the whole replace in one transaction.
 *
 * The "is this function missing?" answer is distinguished from other errors on purpose. A missing
 * function means the migration has not been run, which has a working fallback; a permission error
 * on the same function means the migration *has* run and the grants are wrong, and falling back to
 * the racy path there would hide a deployment mistake behind silently worse behaviour.
 */
async function callSaveFunction(
  sb: SupabaseClient,
  target: LiturgyTarget,
  clean: LiturgySlotInput[],
  expectedVersion: LiturgyVersion | null,
): Promise<SaveFunctionResult> {
  const { data, error } = await sb.rpc("liturgy_save_plan", {
    p_planned: target.kind === "planned",
    p_session_date: target.kind === "planned" ? target.sessionDate : null,
    p_mass_id: target.kind === "planned" ? target.massId : null,
    p_session_id: target.kind === "session" ? target.sessionId : null,
    // `LiturgySlotInput` has no index signature, so it is not assignable to the `jsonb` argument
    // even though every field it holds is JSON-compatible. Normalised above, so nothing
    // unserialisable can reach here.
    p_rows: clean as unknown as Record<string, string | null>[],
    p_expected_revision: expectedRevisionFrom(expectedVersion),
  });

  if (!error) return [(data ?? [])[0] as { revision: number; updated_by_other_device: boolean } | null, null];
  if (isMissingFunction(error)) return [null, "FUNCTION_MISSING"];
  return [null, error.message];
}

/**
 * What the save function returned: the new revision, and whether the caller's version was stale.
 *
 * A tuple of [data, error] rather than a result object, because the two failure modes are
 * genuinely different things — a value, or a string, or the literal `"FUNCTION_MISSING"` meaning
 * "the migration has not been applied and there is a fallback". Collapsing them into one error
 * string would make the fallback indistinguishable from a real database failure.
 */
type SaveFunctionResult =
  | [{ revision: number; updated_by_other_device: boolean } | null, null]
  | [null, string | "FUNCTION_MISSING"];

/** PostgREST reports a missing RPC as `PGRST202`, and sometimes as a bare SQLSTATE. */
function isMissingFunction(error: { code?: string; message: string }): boolean {
  const code = error.code ?? "";
  if (code === "PGRST202") return true;
  // 42883 is undefined_function, 42P01 is undefined_table. Both mean "this build is not deployed
  // here", which is the fallback case rather than a bug worth failing the save over.
  return /does not exist|not found|schema cache/i.test(error.message) && /function/i.test(error.message);
}

/** The pre-030 write path: replace in three statements. */
async function legacyWrite(
  sb: SupabaseClient,
  target: LiturgyTarget,
  clean: LiturgySlotInput[],
  currentVersion: LiturgyVersion,
): Promise<WriteLiturgyResult> {
  const revision = Number(currentVersion.replace(/^r:/, "")) + 1 || 1;

  const { error: delErr } = await scoped(sb, target).delete();
  if (delErr) return { ok: false, code: "DB_ERROR", message: delErr.message };

  const table = tableFor(target);
  const payload = normaliseSortOrder(clean).map(({ row, sort_order }) => {
    const base: Record<string, unknown> = {
      position_label: row.position_label,
      member_id: row.member_id,
      free_text: row.free_text,
      sort_order,
    };
    return target.kind === "planned"
      ? { ...base, session_date: target.sessionDate, mass_id: target.massId, revision }
      : { ...base, session_id: target.sessionId, revision };
  });

  const { data: inserted, error: insErr } = await sb.from(table).insert(payload).select();
  if (insErr) return { ok: false, code: "DB_ERROR", message: insErr.message };

  return {
    ok: true,
    version: `r:${revision}`,
    newLabels: await mergeLabelsIntoCatalog(sb, distinctLabels(clean)),
    updatedByOtherDevice: false,
    rows: (inserted ?? []).map((r) => ({
      position_label: String(r.position_label ?? ""),
      member_id: (r.member_id as string | null) ?? null,
      free_text: (r.free_text as string | null) ?? null,
      memberName: null,
      sort_order: Number(r.sort_order ?? 0),
    })),
  };
}

/** Read a target back after saving, keeping member names from the join. */
async function reReadRows(
  sb: SupabaseClient,
  target: LiturgyTarget,
  memberById: Map<string, { full_name: string; is_active: boolean }>,
): Promise<StoredLiturgyRow[]> {
  const after = await readLiturgyRows(sb, target);
  if (!after.ok) return [];
  return after.rows.map((r) => ({
    ...r,
    memberName: r.member_id ? (memberById.get(r.member_id)?.full_name ?? r.memberName) : r.memberName,
  }));
}

/**
 * Trim, drop label-less rows, and resolve blank fields to null.
 *
 * A row whose position has nobody in it is kept, not dropped. That looks wasteful but the whole
 * "2 of 9 positions unassigned" figure and the whole "Needs attention" card are derived from
 * stored rows: a gap that is never written is a gap that cannot be counted, so the officer would
 * see a fully staffed Mass for one that is short two servers. Both tables allow `member_id` and
 * `free_text` to be null, which is how an unfilled position is represented.
 */
function normaliseSlotInput(slots: LiturgySlotInput[]): LiturgySlotInput[] {
  const out: LiturgySlotInput[] = [];
  for (const s of slots) {
    const label = (s.position_label ?? "").trim().replace(/\s+/g, " ");
    if (label.length === 0) continue;
    const memberId = s.member_id ?? null;
    const guest = (s.free_text ?? "").trim();
    // A row carries a member or a typed name, never both. `slotSchema` deliberately accepts both
    // rather than rejecting the payload, leaving the choice to this function, so the choice has to
    // actually be made here: stored as-is, a row would print the guest name on the sheet while
    // counting the member for conflicts. A real member wins, because it is the one with a roster
    // entry behind it.
    out.push({
      position_label: label,
      member_id: memberId,
      free_text: memberId ? null : guest.length ? guest : null,
    });
  }
  return out;
}

/**
 * Add labels the parish has not used before to the catalog (LIT-1: the combobox "still accepts a
 * new label, which is added to the catalog after saving").
 *
 * Silently ignored on failure. A failed suggestion insert must not lose the lineup that was
 * just saved, which is the thing the officer actually asked for.
 */
async function mergeLabelsIntoCatalog(sb: SupabaseClient, labels: string[]): Promise<string[]> {
  const { data: existing, error } = await sb.from("liturgy_positions").select("label");
  if (error) return [];

  const { toInsert } = mergePositionCatalog(
    (existing ?? []).map((r) => String(r.label ?? "")),
    labels,
  );
  if (toInsert.length === 0) return [];

  const { data: maxRow } = await sb
    .from("liturgy_positions")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startAt = maxRow ? Number(maxRow.sort_order ?? 0) + 1 : 0;

  await sb
    .from("liturgy_positions")
    .insert(toInsert.map((label, i) => ({ label, sort_order: startAt + i })));

  return toInsert;
}

// ======================================================================================
// Warnings
// ======================================================================================

export type LiturgyWarning = {
  kind: "duplicate_in_mass" | "double_booked" | "inactive_member";
  memberId: string;
  memberName: string;
  positionLabel: string;
  detail: string;
};

/**
 * LIT-3. Runs after a save so the returned rows already reflect what is stored.
 *
 * The same-date Masses are read here rather than passed in, because the caller has no reason to
 * know about them and getting it wrong would silently skip the check.
 */
export async function computeWarnings(
  sb: SupabaseClient,
  target: LiturgyTarget,
  rows: StoredLiturgyRow[],
): Promise<{ warnings: LiturgyWarning[]; summary: string }> {
  const sameDay = await readSameDayMasses(sb, target);
  const memberIds = [...new Set(rows.map((r) => r.member_id).filter((id): id is string => !!id))];

  let memberMap: Map<string, { id: string; full_name: string; is_active: boolean }> | undefined;
  if (memberIds.length > 0) {
    const { data } = await sb.from("members").select("id, full_name, is_active").in("id", memberIds);
    memberMap = new Map(
      (data ?? []).map((m) => [
        String(m.id),
        { id: String(m.id), full_name: String(m.full_name ?? ""), is_active: m.is_active !== false },
      ]),
    );
  }

  const warnings = detectConflicts({
    entries: rows,
    sameDayMasses: sameDay,
    members: memberMap,
  });

  return { warnings, summary: summariseConflicts(warnings) };
}

/** The Mass context needed to name a double-booking. */
async function readSameDayMasses(
  sb: SupabaseClient,
  target: LiturgyTarget,
): Promise<Array<{ massId: string; massName: string; time: string | null; entries: LiturgyEntry[] }>> {
  // Resolve the session case down to a (date, mass) pair first. A session and its planned rows
  // describe the same Mass on the same day, and the conflict check does not care which table
  // the rows came from.
  let sessionDate: string;
  let selfMassId: string;

  if (target.kind === "planned") {
    sessionDate = target.sessionDate;
    selfMassId = target.massId;
  } else {
    const { data: session } = await sb
      .from("attendance_sessions")
      .select("session_date, mass_id")
      .eq("id", target.sessionId)
      .maybeSingle();
    if (!session) return [];
    sessionDate = String(session.session_date);
    selfMassId = String(session.mass_id);
  }

  const { data: massRows } = await sb.from("masses").select("id, name, default_time");
  const massName = new Map<string, string>();
  const massTime = new Map<string, string | null>();
  for (const m of massRows ?? []) {
    massName.set(String(m.id), String(m.name ?? "Mass"));
    massTime.set(String(m.id), (m.default_time as string | null) ?? null);
  }

  // Both tables are read, not just `liturgy_planned`. Once a Mass has been held its rows live in
  // `session_liturgy_servers`, so a planned-only read misses every double-booking involving a
  // Mass that has already happened — which is the common case for "same morning".
  const byMass = new Map<string, LiturgyEntry[]>();
  const collect = (massId: string, r: Record<string, unknown>) => {
    const list = byMass.get(massId) ?? [];
    list.push({
      position_label: String(r.position_label ?? ""),
      member_id: (r.member_id as string | null) ?? null,
      free_text: (r.free_text as string | null) ?? null,
      memberName: memberNameFrom(r.members),
    });
    byMass.set(massId, list);
  };

  const { data: planned } = await sb
    .from("liturgy_planned")
    .select("mass_id, position_label, member_id, free_text, members(full_name)")
    .eq("session_date", sessionDate);

  for (const r of planned ?? []) {
    const massId = String(r.mass_id);
    if (massId === selfMassId) continue;
    collect(massId, r as Record<string, unknown>);
  }

  const { data: sessions } = await sb
    .from("attendance_sessions")
    .select("id, mass_id")
    .eq("session_date", sessionDate);

  const otherSessionIds = (sessions ?? [])
    .filter((s) => String(s.mass_id) !== selfMassId)
    .map((s) => String(s.id));

  if (otherSessionIds.length > 0) {
    const massBySession = new Map((sessions ?? []).map((s) => [String(s.id), String(s.mass_id)]));
    const { data: served } = await sb
      .from("session_liturgy_servers")
      .select("session_id, position_label, member_id, free_text, members(full_name)")
      .in("session_id", otherSessionIds);

    for (const r of served ?? []) {
      const massId = massBySession.get(String(r.session_id));
      if (!massId) continue;
      collect(massId, r as Record<string, unknown>);
    }
  }

  return [...byMass.entries()]
    .filter(([, entries]) => entries.length > 0)
    .map(([massId, entries]) => ({
      massId,
      massName: massName.get(massId) ?? "Mass",
      time: massTime.get(massId) ?? null,
      entries,
    }));
}

  export function memberNameFrom(joined: unknown): string | null {
  if (Array.isArray(joined) && joined[0]) {
    return (joined[0] as { full_name?: string }).full_name ?? null;
  }
  if (joined && typeof joined === "object" && "full_name" in joined) {
    return (joined as { full_name?: string }).full_name ?? null;
  }
  return null;
}

/** Re-exported so the editor's summary line and the API agree. */
export { countUnassigned, unassignedSummary };