/**
 * The queue behind "Add new assignment": what one queued assignment is, what it is allowed to say,
 * and the words it publishes.
 *
 * Pure, so the rules that are expensive to get wrong can be checked without a browser or a
 * database. The three that matter are here rather than in the component:
 *
 * - a date is not a date until it has been round-tripped, because `<input type="date">` will
 *   happily hand back an empty string through a typed value;
 * - the announcement's delete date has to mean the same instant whether the modal previewed it or
 *   the route stored it, which is why both call this one function;
 * - only an active Mass may be newly assigned, and the filter in the modal that enforces it is a
 *   convenience rather than a rule -- the route re-checks.
 */

import { daysBetween, isIsoDate, resolveTimeZone, shiftDays, zoneOffsetMinutes } from "@/lib/time/church-time";
import { BODY_MAX, TITLE_MAX } from "@/lib/announcements/audience";
import { normalizeLabel, type GenderRule } from "@/lib/liturgy/rules";

/** A season, not a plan. Anything longer than this is a typo rather than an intention. */
export const MAX_DRAFTS = 62;

export type MassOption = { id: string; name: string; is_active?: boolean };

export type TemplateOption = { id: string; name: string };

/**
 * One position in the queue, with the server on it or not.
 *
 * `key` is a client-side identity so React can keep a combobox's focus and open state while rows are
 * added and removed around it. It is never sent anywhere.
 *
 * `required_gender` rides along because it decides who a random draw may pick for this position. It
 * is a tool for drawing, not a property of the assignment, so it is not part of what gets written.
 */
export type DraftRow = {
  key: string;
  position_label: string;
  member_id: string;
  member_name: string;
  required_gender: GenderRule;
};

/** One queued assignment: a date, a Mass, the lineup the officer chose, and whether saving it tells
 *  the parish. */
export type AssignmentDraft = {
  session_date: string;
  mass_id: string;
  template_id: string;
  /** Post it to the announcements feed and push a notification naming the whole roster. */
  announce: boolean;
  /** `YYYY-MM-DD`. The day the announcement stops being shown. Required when `announce`. */
  announce_delete_at: string;
  rows: DraftRow[];
};

export function draftKey(draft: { session_date: string; mass_id: string }): string {
  return `${draft.session_date}|${draft.mass_id}`;
}

/** The cap on the list of saved assignments a screen asks for. */
export const LIST_MAX_DAYS = 185;

/**
 * Where the list of saved assignments starts and ends.
 *
 * Both ends are clamped, and the window is capped, because the two failure modes are different and
 * both are real. Unbounded: an officer asking for the whole history drags every planned row the
 * parish has ever had into one response. Backwards: a start date before the beginning of time is
 * what a page with an empty date field sends, and it is not a mistake anybody made on purpose.
 */
export function listWindow(
  from: string | null,
  to: string | null,
  fallbackFrom: string,
  fallbackTo: string,
): { from: string; to: string } {
  const start = typeof from === "string" && isIsoDate(from) ? from : fallbackFrom;
  const end = typeof to === "string" && isIsoDate(to) ? to : fallbackTo;
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  if (daysBetween(lo, hi) <= LIST_MAX_DAYS) return { from: lo, to: hi };
  // Trimmed from the far end, so the window still ends where the officer asked. An `in` filter on
  // the announcements below needs `from` to be the earlier of the two.
  return { from: shiftDays(hi, -LIST_MAX_DAYS), to: hi };
}

/**
 * The Masses a new assignment may be created for.
 *
 * `is_active` is deliberately not defaulted to true. `/api/masses` returns the flag, and treating a
 * missing one as active would put an unknown Mass in the list -- which is the same as having no
 * filter at all. A Mass created before the column existed reads as inactive here, which is the safe
 * direction to be wrong in: the officer picks it from the Mass settings page instead.
 */
export function activeMasses(masses: readonly MassOption[]): MassOption[] {
  return masses.filter((m) => m.is_active === true);
}

/**
 * Why this draft cannot be queued, or null when it can.
 *
 * `context` carries the lookups rather than taking them, so the same rules run against whatever
 * list the caller has and can be checked with three literals.
 */
export function validateDraft(
  draft: AssignmentDraft,
  context: { masses: readonly MassOption[]; templates: readonly TemplateOption[] },
): string | null {
  if (!isIsoDate(draft.session_date)) return "Choose a date for the assignment.";

  const mass = context.masses.find((m) => m.id === draft.mass_id);
  if (!mass) return "Choose which Mass this assignment is for.";
  if (mass.is_active !== true) return `${mass.name} is not active, so it cannot be newly assigned.`;

  if (!context.templates.some((t) => t.id === draft.template_id) && draft.template_id !== "") {
    return "That template no longer exists. Choose another, or clear it and build the positions by hand.";
  }

  // The template is a shortcut, not a requirement. It was required while the draw was the only way to
  // get a server onto a position, which left two things broken: an officer who wanted one unusual
  // position had to pick a template to get at the add button, and a saved roster -- which does not
  // record where it came from -- could not be opened for correction at all.
  if (draft.rows.filter((r) => r.position_label.trim().length > 0).length === 0) {
    return "Add at least one position before saving.";
  }

  if (draft.announce) {
    if (!isIsoDate(draft.announce_delete_at)) {
      return "Choose the day the announcement will be removed, or untick announcing.";
    }
    if (draft.announce_delete_at < draft.session_date) {
      return "The announcement would be removed before the Mass it is announcing.";
    }
  }

  return null;
}

/** A fresh row with nothing on it. */
export function blankRow(required_gender: GenderRule = "any"): DraftRow {
  return { key: crypto.randomUUID(), position_label: "", member_id: "", member_name: "", required_gender };
}

/**
 * Bring in a template's positions without disturbing what is already there.
 *
 * A position the sheet already has is left exactly as it is, member included, so choosing a template
 * twice -- or choosing one after picking servers by hand -- never silently un-books somebody. Compared
 * normalized, because "Crucifix" and "crucifix " are one position and a second row for it would be
 * two rows the save would write.
 */
export function seedRowsFromTemplate(
  rows: readonly DraftRow[],
  positions: ReadonlyArray<{ position_label: string; required_gender: GenderRule }>,
): DraftRow[] {
  const present = new Set(rows.map((r) => normalizeLabel(r.position_label)).filter(Boolean));
  const next = [...rows];
  for (const p of positions) {
    const label = p.position_label.trim();
    const norm = normalizeLabel(label);
    if (norm.length === 0 || present.has(norm)) continue;
    present.add(norm);
    next.push({ ...blankRow(p.required_gender), position_label: label });
  }
  return next;
}

/**
 * The rows that will actually be written.
 *
 * A position with no server is dropped rather than stored empty, because the write endpoint requires
 * a member on every row it keeps -- an empty row would read as a position nobody can take, which is a
 * different statement from "not planned yet". `draftUnassigned` is what tells the officer which ones
 * were dropped.
 */
export function draftSlots(
  draft: AssignmentDraft,
): Array<{ position_label: string; member_id: string }> {
  return draft.rows
    .filter((r) => r.position_label.trim().length > 0 && r.member_id)
    .map((r) => ({ position_label: r.position_label.trim(), member_id: r.member_id }));
}

/** Positions with a name but nobody on them. */
export function draftUnassigned(draft: AssignmentDraft): number {
  return draft.rows.filter((r) => r.position_label.trim().length > 0 && !r.member_id).length;
}

/** Positions with a server, as the queue list shows them. */
export function draftFilled(draft: AssignmentDraft): number {
  return draftSlots(draft).length;
}

/**
 * The instant an announcement stops being shown, given the day it should disappear.
 *
 * The officer picks a *day*, and the obvious reading of "delete it on the 12th" is "it is still
 * there on the 12th". So this is the last instant of that day in the church's own timezone:
 * `delete_at` is a timestamp and `isExpired` compares it against now, so midnight would drop the
 * post before anybody had read it.
 *
 * Pure despite taking a timezone, because `zoneOffsetMinutes` answers from the zone and the instant
 * alone. Two passes, because a zone with daylight saving can have a different offset on the far
 * side of a transition and the first guess may be taken there.
 */
export function endOfDayInstant(date: string, timezone: string | null | undefined): string {
  const zone = resolveTimeZone(timezone);
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const firstPass = wall - zoneOffsetMinutes(zone, new Date(wall)) * 60_000;
  return new Date(wall - zoneOffsetMinutes(zone, new Date(firstPass)) * 60_000).toISOString();
}

/** One line per position, for both the announcement and the notification. */
export function rosterLines(
  slots: ReadonlyArray<{ position_label: string; member_name: string | null }>,
): string[] {
  return slots.map((s) => `${s.position_label}: ${s.member_name?.trim() || "not filled"}`);
}

export function announcementTitle(massName: string, dateLabel: string): string {
  return `Servers · ${massName} · ${dateLabel}`.slice(0, TITLE_MAX);
}

/**
 * The announcement body, trimmed to the column rather than failing to save.
 *
 * `BODY_MAX` is 2000 characters and a roster is unbounded, so a long template on a big parish would
 * otherwise come back as a 500 from Postgres carrying a constraint name nobody can act on. Dropping
 * whole lines and saying how many were dropped is the honest version: the count on the announcement
 * stays accurate, and the full roster is one tap away in the app.
 */
export function announcementBody(head: string, lines: readonly string[]): string {
  const kept: string[] = [];
  let used = head.length;
  let omitted = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (used + cost > BODY_MAX) {
      omitted += 1;
      continue;
    }
    kept.push(line);
    used += cost;
  }
  const tail =
    omitted === 0
      ? ""
      : `${kept.length > 0 ? "\n\n" : ""}…and ${omitted} more position${omitted === 1 ? "" : "s"}. Open the day in the app for the whole roster.`;
  return kept.length > 0 ? `${head}\n\n${kept.join("\n")}${tail}` : `${head}${tail}`;
}

/**
 * Adding the same date and Mass twice replaces the first entry rather than stacking.
 *
 * The alternative -- two entries for one Sunday -- saves as two writes to the same rows and then
 * announces whichever happened to be last, which reads as the app having lost the first one. The
 * officer still gets one line per date and Mass, and a note that it was updated.
 */
export function upsertDraft(
  drafts: readonly AssignmentDraft[],
  draft: AssignmentDraft,
): { drafts: AssignmentDraft[]; replaced: boolean } {
  const key = draftKey(draft);
  const index = drafts.findIndex((d) => draftKey(d) === key);
  if (index === -1) return { drafts: [...drafts, draft], replaced: false };
  const next = [...drafts];
  next[index] = draft;
  return { drafts: next, replaced: true };
}