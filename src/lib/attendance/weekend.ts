/**
 * ATT-2: working out which Sunday to create sessions for.
 *
 * The cron fires Thursday 00:00 UTC and creates sessions for "the coming Sunday".
 * That phrase is the whole risk: get it wrong and sessions land on a Sunday that has
 * already happened, and the secretary either sees a phantom Mass on the calendar or
 * has to delete it by hand.
 *
 * So the rule is stated explicitly. `nextSunday` is the first Sunday strictly after
 * the reference date. Thursday → that same week's Sunday. Friday, Saturday → the
 * following Sunday, because this week has slipped past. Sunday itself → the next one,
 * because by 00:00 UTC Monday the Mass has been and gone.
 */

const MS_PER_DAY = 86_400_000;

function toUtcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday. */
function weekday(iso: string): number {
  return toUtcDay(iso).getUTCDay();
}

/** The first Sunday strictly after `from`. */
export function nextSunday(from: string): string {
  const current = weekday(from);
  const daysAhead = current === 0 ? 7 : 7 - current;
  return toIso(new Date(toUtcDay(from).getTime() + daysAhead * MS_PER_DAY));
}

/**
 * The Sunday the weekly cron should prepare.
 *
 * Separate from `nextSunday` so the cron and the manual "Create this weekend's
 * sessions" button can differ deliberately later without either silently changing
 * the other. Right now they are the same rule, which is what the spec asks for.
 */
export function comingSunday(today: string): string {
  return nextSunday(today);
}

/** True for the Saturday and Sunday a Sunday belongs to, for the "this weekend" label. */
export function weekendForSunday(sunday: string): { saturday: string; sunday: string } {
  return { saturday: toIso(new Date(toUtcDay(sunday).getTime() - MS_PER_DAY)), sunday };
}
