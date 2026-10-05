/**
 * The editor's own row model.
 *
 * This is not `LiturgyRow`. That type is the wire shape — a position and whoever is in it — and it
 * has nowhere to put the two things the screen needs and the wire does not: which input the
 * officer is currently typing into, and whether they have touched the row at all.
 *
 * Keeping that here rather than in the component is what lets "does the list differ from what was
 * loaded" be a tested function instead of a `JSON.stringify` comparison scattered through event
 * handlers. Principle 8 of the revamp says rules live in pure functions with unit tests, not
 * inside components, and the leave-guard is a rule.
 */

import { normalizeLabel, type LiturgyRow, type LiturgySlotInput } from "./rules";

export type AssigneeKind = "member" | "guest" | "empty";

/** What the position wants from a randomly assigned server. */
export type GenderRule = "male" | "female" | "any";

export type EditorRow = {
  /** Stable across reorders and edits, so React keys and drag state survive both. */
  id: string;
  position_label: string;
  member_id: string | null;
  member_name: string | null;
  free_text: string | null;
  /** Which picker this row is using. Switching to guest clears the member, and back again. */
  assignee: AssigneeKind;
  /**
   * The criterion a "randomly fill" offer uses for this row. Client-side only: it is not stored
   * with the plan, because it is the tool used to *choose* who serves, not a property of the
   * assignment itself. `any` is the normal case; the toggle exists so a position that is, say, a
   * women's thurifer gets a woman.
   */
  required_gender?: GenderRule;
};

/**
 * What the server sends, in editor shape.
 *
 * The member's name rides along when the endpoint joined it. `/api/liturgy/*` spells it
 * `memberName` (it comes straight off the stored row) while the older `/api/attendance/*` endpoints
 * spell it `member_name`, so both are accepted: the editor shows a name, never a UUID, and the
 * officer should not have to care which endpoint produced the rows.
 */
export function rowsFromServer(
  rows: Array<LiturgyRow & { member_name?: string | null; memberName?: string | null }>,
): EditorRow[] {
  return rows.map((r, i) => ({
    id: `row-${i}`,
    position_label: r.position_label,
    member_id: r.member_id,
    member_name: r.member_name ?? r.memberName ?? null,
    free_text: r.free_text,
    assignee: r.member_id ? "member" : r.free_text ? "guest" : "empty",
  }));
}

/** A new, blank row. Not blank enough to be dropped: see `isRealRow`. */
export function newRow(id: string): EditorRow {
  return {
    id,
    position_label: "",
    member_id: null,
    member_name: null,
    free_text: null,
    assignee: "empty",
  };
}

/**
 * Whether a row is worth sending.
 *
 * A row is real once it has a position label. The assignee may be empty, because an unassigned
 * position is a real thing the officer means: it is what the sheet prints as a gap and what the
 * "2 of 9 positions unassigned" figure counts. A row with no label is a stray input, not a
 * position.
 */
export function isRealRow(row: EditorRow): boolean {
  return normalizeLabel(row.position_label).length > 0;
}

/** The rows to PUT, in order, with the blank ones removed. */
export function toSlots(rows: EditorRow[]): LiturgySlotInput[] {
  return rows.filter(isRealRow).map((r) => ({
    position_label: rowPositionLabel(r),
    member_id: r.assignee === "member" ? r.member_id : null,
    free_text: r.assignee === "guest" ? trimmedFreeText(r.free_text) : null,
  }));
}

/** Labels are stored collapsed, so "Crucifix " never becomes a second suggestion. */
export function rowPositionLabel(row: EditorRow): string {
  return row.position_label.trim().replace(/\s+/g, " ");
}

export function trimmedFreeText(value: string | null): string | null {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Whether the list differs from what was loaded.
 *
 * Compared by value, not by reference: the officer retyping "Crucifix " with the same space back
 * has not changed anything, and being told they have unsaved work is worse than the opposite
 * mistake, because it is the one that trains people to click through warnings.
 *
 * Order is part of the comparison. Reordering is an edit, and the spec makes reordering persist.
 */
export function isDirty(rows: EditorRow[], saved: EditorRow[]): boolean {
  const a = rows.map(comparable);
  const b = saved.map(comparable);
  if (a.length !== b.length) return true;
  return a.some((row, i) => row !== b[i]);
}

function comparable(row: EditorRow): string {
  return [
    rowPositionLabel(row),
    row.assignee,
    row.assignee === "member" ? row.member_id ?? "" : "",
    row.assignee === "guest" ? trimmedFreeText(row.free_text) ?? "" : "",
  ].join("\u0000");
}

/** The row's assignee as one display string, for the summary line and for the sheet. */
export function assigneeLabel(row: EditorRow): string {
  if (row.assignee === "member") return row.member_name ?? row.member_id ?? "";
  if (row.assignee === "guest") return trimmedFreeText(row.free_text) ?? "";
  return "";
}

/** Apply a member choice to a row. */
export function withMember(row: EditorRow, member: { id: string; name: string }): EditorRow {
  return { ...row, assignee: "member", member_id: member.id, member_name: member.name, free_text: null };
}

/** Switch a row to free text, dropping the member so the two cannot both be stored. */
export function withGuest(row: EditorRow, name: string): EditorRow {
  return { ...row, assignee: "guest", free_text: name, member_id: null, member_name: null };
}

/** Clear the assignee but keep the position: "nobody is doing this one" is a state, not a delete. */
export function withNoAssignee(row: EditorRow): EditorRow {
  return { ...row, assignee: "empty", free_text: null, member_id: null, member_name: null };
}

/** Move a row, keeping its identity. `moveRow` in rules is generic; this adds the id guarantee. */
export function moveEditorRow(rows: EditorRow[], from: number, to: number): EditorRow[] {
  if (from === to) return rows;
  if (from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = rows.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Replace one row by id, so callers never depend on array position after a reorder. */
export function updateRow(rows: EditorRow[], id: string, patch: Partial<EditorRow>): EditorRow[] {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** Add a row after `afterId`, or at the end when `afterId` is not found. */
export function insertRow(rows: EditorRow[], afterId: string | null, row: EditorRow): EditorRow[] {
  const at = afterId ? rows.findIndex((r) => r.id === afterId) : -1;
  if (at === -1) return [...rows, row];
  const next = rows.slice();
  next.splice(at + 1, 0, row);
  return next;
}

export function removeRow(rows: EditorRow[], id: string): EditorRow[] {
  return rows.filter((r) => r.id !== id);
}
