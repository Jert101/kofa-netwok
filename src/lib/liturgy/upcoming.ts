/**
 * LIT-5: upcoming assignments and the officer's "needs attention" list.
 *
 * Both are shaping, not querying — the SQL already happened. Keeping the reshaping pure means the
 * rules that are easy to get wrong (which dates count as upcoming, what "unassigned" means for a
 * Mass that has no plan at all, how a search that matches nothing should look) are testable
 * without a database.
 */

const MS_PER_DAY = 86_400_000;

export type UpcomingSlot = {
  position_label: string;
  member_id: string | null;
  member_name: string | null;
  free_text: string | null;
  /** True when this row is the signed-in member's own assignment (LIT-5, "their own rows"). */
  mine: boolean;
};

export type UpcomingMass = {
  mass_id: string;
  mass_name: string;
  session_id: string | null;
  /** `HH:MM` from `masses.default_time`, or null when the Mass has no configured time. */
  time?: string | null;
  slots: UpcomingSlot[];
};

export type UpcomingDay = {
  date: string;
  masses: UpcomingMass[];
};

export type MassRef = { id: string; name: string };

/** Clamp the window so a bad `?days=` cannot ask for a decade of plans. */
export function clampWindowDays(raw: string | null, fallback = 14, max = 60): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/**
 * Inclusive start and end dates for an N-day window starting on `today`.
 *
 * Both are returned as ISO strings, not Dates. Every caller feeds them straight back into a date
 * string, and handing out a `Date` here invites one of them to interpolate it with a template
 * literal — which produces "Thu Oct 02 2026 …" rather than "2026-10-02" and silently yields an
 * invalid date downstream.
 */
export function windowFor(today: string, days: number): { start: string; end: string } {
  const start = new Date(`${today}T00:00:00Z`);
  const startIso = Number.isNaN(start.getTime()) ? today : start.toISOString().slice(0, 10);
  const end = new Date(start.getTime() + (days - 1) * MS_PER_DAY).toISOString().slice(0, 10);
  return { start: startIso, end };
}

/**
 * A slot is somebody's own when the row names them.
 *
 * Guests never match, because free text is not an identity — "John" in two different rows is not
 * evidence that the same person is serving twice, and neither is it evidence that this is you.
 */
export function markOwnSlots(slots: UpcomingSlot[], viewerMemberId: string | null): UpcomingSlot[] {
  if (!viewerMemberId) return slots.map((s) => ({ ...s, mine: false }));
  return slots.map((s) => ({ ...s, mine: s.member_id !== null && s.member_id === viewerMemberId }));
}

/**
 * LIT-5's search box: "a search box to find a name".
 *
 * Matches a name anywhere in the day, and a day that matches is kept whole rather than trimmed to
 * the matching rows. An officer looking for Reyes is answering "when am I on?", and a day that
 * shows one hit and silently hides the rest of that Mass's lineup answers a different question.
 * With no query, everything comes back.
 */
export function filterUpcoming(days: UpcomingDay[], query: string | null): UpcomingDay[] {
  const q = (query ?? "").trim().toLowerCase();
  if (q.length === 0) return days;

  return days
    .map((day) => {
      const massMatches = day.masses.filter((mass) =>
        mass.slots.some(
          (s) =>
            (s.member_name ?? "").toLowerCase().includes(q) ||
            (s.free_text ?? "").toLowerCase().includes(q) ||
            // Position labels too: officers search "thurifer" as often as a surname, and the
            // spec only promises a name box, so matching more is a convenience rather than a
            // change of meaning.
            s.position_label.toLowerCase().includes(q) ||
            mass.mass_name.toLowerCase().includes(q),
        ),
      );
      return { ...day, masses: massMatches };
    })
    .filter((day) => day.masses.length > 0);
}

/**
 * LIT-5: "their own rows are highlighted and pinned to the top".
 *
 * A day with any of the viewer's own rows floats above the rest of the window; within a day the
 * Masses keep their catalog order, because reordering them by whether the viewer happens to be on
 * would make the list jump around as the window moves.
 */
export function pinOwnDays(days: UpcomingDay[]): UpcomingDay[] {
  const own = days.filter((d) => d.masses.some((m) => m.slots.some((s) => s.mine)));
  const rest = days.filter((d) => !own.includes(d));
  return [...own, ...rest];
}

/**
 * Count the viewer's own assignments across the window. The heading number a member reads first,
 * so it is computed here rather than guessed by the component.
 */
export function countOwnAssignments(days: UpcomingDay[]): number {
  return days.reduce(
    (total, day) =>
      total +
      day.masses.reduce(
        (n, mass) => n + mass.slots.filter((s) => s.mine).length,
        0,
      ),
    0,
  );
}

// ======================================================================================
// Which rows are the real ones
// ======================================================================================

export type PlanRow = {
  position_label: string;
  member_id: string | null;
  free_text: string | null;
  member_name: string | null;
};

/**
 * Which rows describe who is actually serving for one (date, Mass).
 *
 * Spec §7: "On session creation, planned rows for that (date, mass) seed the session rows. After
 * the session exists, editing planned rows for that date does not change the session." So once a
 * session holds rows, those are the truth and the plan is history.
 *
 * The empty-session fallback is the subtle part and is preserved deliberately: a session that was
 * created by the automatic weekend cron has *no* rows until an officer types them, and until then
 * the planned rows are the only description of that Mass. Without this branch every automatically
 * created session would show as "no plan" and the officer's own work would appear to have vanished.
 */
export function pickEffectiveSlots(
  planned: PlanRow[],
  served: PlanRow[],
): { source: "session" | "planned"; slots: PlanRow[] } {
  if (served.length > 0) return { source: "session", slots: served };
  return { source: "planned", slots: planned };
}

// ======================================================================================
// Needs attention
// ======================================================================================

export type AttentionItem = {
  date: string;
  mass_id: string;
  mass_name: string;
  /** `no_plan` when the Mass has no rows at all; `unassigned` when some position is empty. */
  reason: "no_plan" | "unassigned";
  positions: number;
  unassigned: number;
  /** Position labels with nobody in them, so the card can name what is missing. */
  unassigned_labels: string[];
};

/**
 * Which of a window's dates still need work.
 *
 * Two separate reasons, kept apart on purpose. "No plan at all" and "a plan with gaps" are
 * different amounts of work, and merging them into one count would leave an officer unable to
 * tell a parish that has not started planning from one that has nearly finished.
 *
 * Masses with no rows cannot be counted from the plan summary alone — a date where every Mass is
 * unplanned does not appear there at all — so `no_plan` items are found by walking the Mass
 * catalog across the window instead.
 */
import { normalizeLabel } from "./rules";

export function needsAttention(input: {
  days: UpcomingDay[];
  masses: MassRef[];
  today: string;
  windowDays: number;
}): AttentionItem[] {
  const { masses, today, windowDays } = input;

  // What the plans say, keyed by (date, mass).
  const planned = new Map<string, { positions: number; unassigned: number; labels: string[] }>();
  for (const day of input.days) {
    for (const mass of day.masses) {
      // The normalized key decides whether two rows are the same position; `display` keeps the label
      // as the parish actually spells it, because "Crucifix" reads better on a card than
      // "crucifix", and the officer has to act on what the label says.
      const byPosition = new Map<string, { filled: boolean; display: string }>();
      for (const slot of mass.slots) {
        // `normalizeLabel`, not a local trim+lowercase: folding only the case and the ends would
        // count "Crucifix" and "crucifix  " as two positions, and report a position as unassigned
        // while also listing it as filled somewhere else on the card.
        const key = normalizeLabel(slot.position_label);
        const filled = Boolean(slot.member_id) || Boolean((slot.free_text ?? "").trim());
        const entry = byPosition.get(key);
        if (entry) entry.filled = entry.filled || filled;
        else byPosition.set(key, { filled, display: slot.position_label.trim() });
      }
      // `labels` is already exactly the unfilled positions, so it *is* the unassigned count.
      // Deriving the count as `positions - labels.length` inverts it: a fully staffed plan comes
      // out as "1 unassigned" and a plan whose only position is empty comes out as fully staffed.
      const labels = [...byPosition.values()]
        .filter((v) => !v.filled)
        .map((v) => v.display);
      planned.set(`${day.date}\0${mass.mass_id}`, {
        positions: byPosition.size,
        unassigned: labels.length,
        labels,
      });
    }
  }

  const items: AttentionItem[] = [];
  const { start, end } = windowFor(today, windowDays);

  for (const date of datesBetween(start, end)) {
    for (const mass of masses) {
      const entry = planned.get(`${date}\0${mass.id}`);
      if (!entry) {
        items.push({
          date,
          mass_id: mass.id,
          mass_name: mass.name,
          reason: "no_plan",
          positions: 0,
          unassigned: 0,
          unassigned_labels: [],
        });
        continue;
      }
      if (entry.unassigned > 0) {
        items.push({
          date,
          mass_id: mass.id,
          mass_name: mass.name,
          reason: "unassigned",
          positions: entry.positions,
          unassigned: entry.unassigned,
          unassigned_labels: entry.labels,
        });
      }
    }
  }

  return items;
}

/** Inclusive list of ISO dates, without depending on the host's timezone. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setTime(cursor.getTime() + MS_PER_DAY);
  }
  return out;
}

/** "Sun 2 Nov" — the day label the upcoming list and the sheet both use. */
export function formatDayLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

/**
 * "5:30 AM" from a Postgres `time`.
 *
 * Returns null rather than an empty string when there is no time configured, so callers can
 * decide between omitting it and printing a placeholder.
 */
export function formatMassTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute} ${suffix}`;
}

/** "3 positions still to fill", with the count called out for the common small cases. */
export function attentionSummary(items: AttentionItem[]): string {
  if (items.length === 0) return "Nothing needs attention in the next two weeks.";
  const noPlan = items.filter((i) => i.reason === "no_plan").length;
  const gaps = items.filter((i) => i.reason === "unassigned").length;
  const parts: string[] = [];
  if (gaps > 0) parts.push(`${gaps} plan${gaps === 1 ? "" : "s"} with gaps`);
  if (noPlan > 0) parts.push(`${noPlan} not started`);
  return `${parts.join(", ")} in the next two weeks.`;
}