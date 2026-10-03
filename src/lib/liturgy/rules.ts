/**
 * LIT-2 build task 2: the pure rules, with no database and no React.
 *
 * These are the parts of the planner that are easy to get subtly wrong and expensive to notice
 * later: what counts as the same label, who is double-booked, and what happens to the rows when
 * an officer copies last week. Keeping them here means they can be tested directly rather than
 * inferred from a screen.
 */

export type LiturgyMemberRef = {
  id: string;
  full_name: string;
  is_active: boolean;
};

/**
 * One row of either liturgy table. They are structurally identical apart from how they are
 * keyed, so the rules read one shape and the routes map their table onto it.
 */
export type LiturgyRow = {
  position_label: string;
  member_id: string | null;
  free_text: string | null;
};

export type LiturgySlotInput = {
  position_label: string;
  member_id: string | null;
  free_text: string | null;
};

// ======================================================================================
// Labels: LIT-4, and problem P1
// ======================================================================================

/**
 * The comparison form of a label.
 *
 * Case-insensitive, whitespace-collapsed and trimmed. "  Candle   1 " and "candle 1" are one
 * position; without this the catalog accumulates "Candle 1", "candle 1" and "candle  1" as
 * three suggestions that all look like the same thing to the person choosing between them.
 */
export function normalizeLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isSameLabel(a: string, b: string): boolean {
  const na = normalizeLabel(a);
  return na.length > 0 && na === normalizeLabel(b);
}

/**
 * Merge new labels into an existing catalog without creating case-variant duplicates.
 *
 * The stored casing of the *existing* entry wins (spec §7: "the stored casing is the first one
 * seen"). So `mergePositionCatalog(["Candle 1"], ["candle 1"])` returns `["Candle 1"]` and
 * reports nothing to insert, rather than rewritng the label the parish has been using.
 */
export function mergePositionCatalog(
  existing: string[],
  incoming: string[],
): { labels: string[]; toInsert: string[] } {
  const byNorm = new Map<string, string>();
  for (const label of existing) {
    const norm = normalizeLabel(label);
    // First occurrence wins, so a catalog already containing variants keeps its earliest.
    if (norm.length > 0 && !byNorm.has(norm)) byNorm.set(norm, label.trim());
  }

  const toInsert: string[] = [];
  for (const label of incoming) {
    const norm = normalizeLabel(label);
    if (norm.length === 0) continue;
    if (byNorm.has(norm)) continue;
    byNorm.set(norm, label.trim());
    toInsert.push(label.trim());
  }

  return { labels: [...byNorm.values()], toInsert };
}

/** Distinct labels for a set of rows, in first-seen order. */
export function distinctLabels(rows: LiturgyRow[]): string[] {
  const byNorm = new Map<string, string>();
  for (const r of rows) {
    const norm = normalizeLabel(r.position_label);
    if (norm.length > 0 && !byNorm.has(norm)) byNorm.set(norm, r.position_label.trim());
  }
  return [...byNorm.values()];
}

// ======================================================================================
// Conflicts: LIT-3
// ======================================================================================

export type ConflictKind = "duplicate_in_mass" | "double_booked" | "inactive_member";

export type LiturgyConflict = {
  kind: ConflictKind;
  memberId: string;
  memberName: string;
  /** Label of the row this conflict is about. */
  positionLabel: string;
  /**
   * For `duplicate_in_mass`, the other position holding the same member at this Mass.
   * For `double_booked`, the Mass name and time, when known.
   */
  detail: string;
};

export type LiturgyEntry = LiturgyRow & {
  /** Display name, resolved by the caller. */
  memberName: string | null;
};

export type LiturgyMassRef = {
  massId: string;
  massName: string;
  /** `HH:MM` from `masses.default_time`, or null when the Mass has no configured time. */
  time?: string | null;
};

function displayTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/**
 * LIT-3. Warnings, never blocks.
 *
 * The spec is explicit that an officer knows best, so nothing here refuses anything; the
 * caller renders the result. Guests (free text) are excluded throughout, because "John from
 * next door" has no id and cannot be recognised as the same person in two rows.
 *
 * `sameDayMasses` supplies the other Masses on the same date. Passing an empty array is valid
 * and simply skips the double-booking check — which is the correct result when a parish runs
 * one Mass.
 */
export function detectConflicts(input: {
  /** Rows for the Mass being edited. */
  entries: LiturgyEntry[];
  /** Other Masses on the same date, for the double-booking check. */
  sameDayMasses?: Array<{
    massId: string;
    massName: string;
    time?: string | null;
    entries: LiturgyEntry[];
  }>;
  /**
   * The Mass being edited, for naming itself in a cross-Mass message.
   *
   * Unused so far: a cross-Mass warning names the *other* Mass, and naming the edited one too
   * ("Thurifer here and Crucifix at 5:30 AM") reads as a mistake on the screen. Kept because the
   * server has it to hand and a future message may need it.
   */
  thisMass?: LiturgyMassRef;
  members?: Map<string, LiturgyMemberRef>;
}): LiturgyConflict[] {
  const { entries, sameDayMasses = [], members } = input;
  const conflicts: LiturgyConflict[] = [];

  const seenHere = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.member_id) continue;
    const labels = seenHere.get(e.member_id) ?? [];
    labels.push(e.position_label);
    seenHere.set(e.member_id, labels);
  }

  for (const [memberId, labels] of seenHere) {
    const name = entries.find((e) => e.member_id === memberId)?.memberName ?? "This member";

    // Same member at two positions within one Mass. Reported once per extra position rather
    // than once per pair, so three roles at one Mass is two warnings and not three.
    if (labels.length > 1) {
      const [, ...extra] = labels;
      for (const label of extra) {
        const others = labels.filter((l) => l !== label);
        conflicts.push({
          kind: "duplicate_in_mass",
          memberId,
          memberName: name,
          positionLabel: label,
          detail: `${name} is also assigned to ${others.join(", ")} at this Mass.`,
        });
      }
    }

    // Inactive: only reachable through copy or old data, because the write routes reject
    // inactive members. Worth flagging rather than silently dropping, so the parish sees why
    // a name is still on the sheet.
    const member = members?.get(memberId);
    if (member && !member.is_active) {
      conflicts.push({
        kind: "inactive_member",
        memberId,
        memberName: name,
        positionLabel: labels[0],
        detail: `${name} is no longer an active member.`,
      });
    }

    // Same member in two Masses on one date.
    for (const other of sameDayMasses) {
      const inOther = other.entries.some((e) => e.member_id === memberId);
      if (!inOther) continue;
      const time = displayTime(other.time);
      const when = time ? ` at ${time}` : "";
      conflicts.push({
        kind: "double_booked",
        memberId,
        memberName: name,
        positionLabel: labels[0],
        detail: `${name} is also serving ${other.massName}${when} on this date.`,
      });
    }
  }

  return conflicts;
}

/** Human summary for the top of the editor. Empty string when there is nothing to say. */
export function summariseConflicts(conflicts: LiturgyConflict[]): string {
  if (conflicts.length === 0) return "";
  const byKind = new Map<ConflictKind, LiturgyConflict[]>();
  for (const c of conflicts) {
    const list = byKind.get(c.kind) ?? [];
    list.push(c);
    byKind.set(c.kind, list);
  }

  const parts: string[] = [];
  if (byKind.has("duplicate_in_mass")) {
    parts.push(`${byKind.get("duplicate_in_mass")!.length} at two positions in one Mass`);
  }
  if (byKind.has("double_booked")) {
    const n = byKind.get("double_booked")!.length;
    parts.push(`${n} serving two Masses on this date`);
  }
  if (byKind.has("inactive_member")) {
    const n = byKind.get("inactive_member")!.length;
    parts.push(`${n} no longer active`);
  }
  return `Check ${parts.join(", ")}.`;
}

/**
 * LIT-3's last rule, which is a rule about what is *not* a conflict.
 *
 * Serving a role and also being on the roster of the same session are different jobs, so the
 * same person doing both is normal. Kept as an explicit test so nobody "helpfully" adds it as
 * a warning later.
 */
export function isRosterOverlapAConflict(): false {
  return false;
}

// ======================================================================================
// Copy: LIT-2
// ======================================================================================

export type CopyResult = {
  rows: LiturgySlotInput[];
  /** Names dropped because the member is no longer active, for the confirmation message. */
  droppedInactive: string[];
};

/**
 * LIT-2. Copy rows from another date or session into this one.
 *
 * `includeMembers: false` copies positions only, which is the "I want the shape, not the
 * people" case. Inactive members are dropped and returned by name so the confirmation can say
 * *which* were dropped — spec §LIT-2: "Inactive members are dropped and listed in the
 * confirmation." Silently dropping them would leave the officer thinking the copy was complete.
 */
export function buildCopy(input: {
  from: LiturgyRow[];
  members?: Map<string, LiturgyMemberRef>;
  includeMembers: boolean;
}): CopyResult {
  const { from, members, includeMembers } = input;
  const rows: LiturgySlotInput[] = [];
  const droppedInactive: string[] = [];
  const seenDropped = new Set<string>();

  // One row per position when copying positions only. If a position had two people, keeping
  // both would produce a row the editor's per-position shape cannot represent.
  const byPosition = new Map<string, LiturgyRow[]>();
  for (const row of from) {
    const norm = normalizeLabel(row.position_label);
    if (norm.length === 0) continue;
    const list = byPosition.get(norm) ?? [];
    list.push(row);
    byPosition.set(norm, list);
  }

  for (const rows_ of byPosition.values()) {
    const label = rows_[0].position_label.trim();

    if (!includeMembers) {
      rows.push({ position_label: label, member_id: null, free_text: null });
      continue;
    }

    for (const row of rows_) {
      if (row.member_id) {
        const member = members?.get(row.member_id);
        if (member && !member.is_active) {
          if (!seenDropped.has(row.member_id)) {
            seenDropped.add(row.member_id);
            droppedInactive.push(member.full_name);
          }
          continue;
        }
        rows.push({ position_label: label, member_id: row.member_id, free_text: null });
        continue;
      }

      // Guests carry over as guests. There is no id to check against the roster, and dropping
      // them would lose information the officer typed deliberately.
      if (row.free_text && row.free_text.trim()) {
        rows.push({ position_label: label, member_id: null, free_text: row.free_text.trim() });
      }
    }
  }

  return { rows, droppedInactive };
}

/** "Nothing to copy from that date." — spec §8, returned as a message rather than an empty copy. */
export const NOTHING_TO_COPY = "Nothing to copy from that date.";

export function copyOutcomeMessage(droppedInactive: string[]): string | null {
  if (droppedInactive.length === 0) return null;
  const names = droppedInactive.join(", ");
  return `Skipped ${droppedInactive.length} inactive member${droppedInactive.length === 1 ? "" : "s"}: ${names}.`;
}

// ======================================================================================
// Sorting and templates: LIT-1, LIT-4
// ======================================================================================

/**
 * `sort_order` is contiguous from 0 after every save (spec §7).
 *
 * Re-saving an untouched list must produce the same order, so this is a pure re-index rather
 * than a set of comparisons. Gaps would make "row 3" ambiguous between the database and the
 * screen the moment anyone reorders on a different device.
 */
export function normaliseSortOrder<T>(rows: T[]): Array<{ row: T; sort_order: number }> {
  return rows.map((row, i) => ({ row, sort_order: i }));
}

/** Move one row, returning a new array. Out-of-range indices are a no-op, not a crash. */
export function moveRow<T>(rows: T[], from: number, to: number): T[] {
  if (from === to) return rows;
  if (from < 0 || from >= rows.length) return rows;
  if (to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * LIT-4: a template cannot be saved empty or with duplicate labels.
 *
 * Duplicates are compared normalized, so a template of "Crucifix" and "crucifix" is refused
 * rather than saved as a two-slot lineup that loads back as two identical rows.
 */
export function validateTemplateLabels(labels: string[]): {
  ok: true;
  labels: string[];
} | { ok: false; message: string } {
  const cleaned: string[] = [];
  const byNorm = new Map<string, string>();

  for (const raw of labels) {
    const label = raw.trim().replace(/\s+/g, " ");
    if (label.length === 0) continue;
    const norm = normalizeLabel(label);
    if (byNorm.has(norm)) {
      return {
        ok: false,
        message: `"${byNorm.get(norm)}" appears twice. Each position can only be listed once.`,
      };
    }
    byNorm.set(norm, label);
    cleaned.push(label);
  }

  if (cleaned.length === 0) {
    return { ok: false, message: "Add at least one position before saving this template." };
  }

  return { ok: true, labels: cleaned };
}

export function validateTemplateName(name: string): { ok: true; name: string } | { ok: false; message: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return { ok: false, message: "Give this template a name." };
  }
  if (trimmed.length > 60) {
    return { ok: false, message: "Keep the name to 60 characters or fewer." };
  }
  return { ok: true, name: trimmed };
}

// ======================================================================================
// Editor summary: LIT-1 "2 of 9 positions unassigned"
// ======================================================================================

/**
 * Count unassigned positions.
 *
 * A position is a distinct label, not a row, and it is unassigned when none of its rows names
 * a member or a guest. Counting rows instead would report zero unassigned for a sheet where
 * every position has a blank row under it, which is the exact case the summary exists to
 * catch.
 */
export function countUnassigned(rows: LiturgyRow[]): { total: number; unassigned: number } {
  const byPosition = new Map<string, LiturgyRow[]>();
  for (const row of rows) {
    const norm = normalizeLabel(row.position_label);
    if (norm.length === 0) continue;
    const list = byPosition.get(norm) ?? [];
    list.push(row);
    byPosition.set(norm, list);
  }

  let unassigned = 0;
  for (const list of byPosition.values()) {
    const filled = list.some((r) => r.member_id || (r.free_text && r.free_text.trim().length > 0));
    if (!filled) unassigned++;
  }

  return { total: byPosition.size, unassigned };
}

export function unassignedSummary(counts: { total: number; unassigned: number }): string {
  if (counts.total === 0) return "No positions yet.";
  if (counts.unassigned === 0) return `All ${counts.total} positions assigned.`;
  return `${counts.unassigned} of ${counts.total} positions unassigned.`;
}