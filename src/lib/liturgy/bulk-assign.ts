/**
 * The arithmetic behind assigning a whole date range at once.
 *
 * Kept out of the component so it can be tested without a browser or a database, and so the rules
 * that matter -- nobody drawn twice, nobody drawn for two Masses on one day, a position whose rule
 * nobody satisfies left open rather than filled with the wrong person -- are stated once.
 */

import type { GenderRule, TemplatePosition } from "./rules";

/** A range this long is a season, not a plan; anything larger is almost certainly a typo. */
export const MAX_DAYS = 62;

export type BulkMember = { id: string; full_name: string; gender: string | null };

export type BulkSlot = { position_label: string; member_id: string };

/** Every date from `start` to `end`, inclusive, capped at `MAX_DAYS`. */
export function datesInRange(start: string, end: string, limit = MAX_DAYS): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last && out.length < limit) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Draw a random server for each position from the active roll.
 *
 * `usedThisDate` is threaded through the whole day on purpose: the same person cannot serve two Masses
 * on one Sunday, and threading it is what stops that. A position whose rule nobody satisfies is left
 * out rather than filled with someone who does not fit -- the officer sees the gap and decides.
 */
export function drawSlots(
  positions: readonly TemplatePosition[],
  members: readonly BulkMember[],
  usedThisDate: Set<string>,
  random: () => number = Math.random,
): { slots: BulkSlot[]; unfilled: number } {
  const slots: BulkSlot[] = [];
  let unfilled = 0;
  for (const pos of positions) {
    const rule: GenderRule = pos.required_gender;
    const pool = members.filter((m) => {
      if (usedThisDate.has(m.id)) return false;
      if (rule === "any") return true;
      return (m.gender ?? "").toLowerCase() === rule;
    });
    if (pool.length === 0) {
      unfilled += 1;
      continue;
    }
    const pick = pool[Math.floor(random() * pool.length)];
    usedThisDate.add(pick.id);
    slots.push({ position_label: pos.position_label, member_id: pick.id });
  }
  return { slots, unfilled };
}