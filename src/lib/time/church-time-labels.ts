/**
 * Small formatting helpers shared by the payment screens.
 *
 * Kept apart from `church-time.ts` because that file is server-and-client safe pure logic with no React
 * imports and its own tests, while these are presentational strings that only exist to be rendered.
 */

/** "4 Oct 2026" from "2026-10-04". Falls back to the input when it is not a date. */
export function churchTodayLabel(isoDate: string): string {
  const parsed = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return isoDate;
  return new Date(parsed).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "October 2026" from "2026-10-04". Used for installment month labels. */
export function monthLabel(month: string): string {
  const parsed = Date.parse(`${month.slice(0, 7)}-01T00:00:00Z`);
  if (!Number.isFinite(parsed)) return month;
  return new Date(parsed).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Installment status as a word a treasurer would use. */
export function installmentStatusLabel(status: "paid" | "partly_paid" | "due" | "overdue"): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "partly_paid":
      return "Partly paid";
    case "due":
      return "Due";
    case "overdue":
      return "Overdue";
  }
}

/** Tailwind classes per status. Colour is never the only signal: the label says it too. */
export function installmentStatusClass(status: "paid" | "partly_paid" | "due" | "overdue"): string {
  switch (status) {
    case "paid":
      return "text-[var(--success)]";
    case "partly_paid":
      return "text-[var(--text)]";
    case "due":
      return "text-[var(--text-muted)]";
    case "overdue":
      return "text-[var(--danger)]";
  }
}

/**
 * A member's name, trimmed for a card.
 *
 * Spec §DSH-8 in module 10 asks for truncation with a tooltip, and this is where it happens for the
 * payment screens. Three words is enough to identify somebody; a full name is not, and a card that
 * grows to fit the longest name in the parish is a card nobody can scan.
 */
export function truncateName(name: string, max = 28): { text: string; truncated: boolean } {
  if (name.length <= max) return { text: name, truncated: false };
  return { text: `${name.slice(0, max - 1).trimEnd()}...`, truncated: true };
}