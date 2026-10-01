/**
 * ATT-7: what the lock banner says, and whether the roster is editable.
 *
 * The banner text is the only place the parish learns why a screen has gone
 * read-only, so it is built here rather than assembled in the component. Two things
 * it has to get right:
 *
 * It names the month and what state the report is in. "Attendance is read-only" on
 * its own reads like the app is broken. "The August 2026 report is pending approval"
 * reads like a process.
 *
 * It distinguishes a month that is locked from a Mass that simply has not happened
 * yet. Both mean "you cannot edit this", and they need different words: one is
 * waiting on a person, the other is waiting on the clock.
 */

export type Editability =
  | { editable: true; banner: null }
  | { editable: false; banner: { tone: "locked" | "future"; title: string; body: string } };

/** The sentence the spec asks for, reused in both the banner and the 409. */
export function lockBannerText(monthLabel: string, status: "pending" | "approved"): string {
  return `The ${monthLabel} report is ${
    status === "pending" ? "pending approval" : "approved"
  }. Attendance is read-only.`;
}

export function decideEditability({
  locked,
  lockReason,
  lockMonthLabel,
  isFuture,
}: {
  locked: boolean;
  lockReason?: "pending_approval" | "approved" | null;
  lockMonthLabel?: string | null;
  isFuture: boolean;
}): Editability {
  // Lock is checked first, matching the server guard. If a month is locked *and* the
  // Mass is in the future, the lock is the more useful thing to say, because it will
  // not resolve by itself.
  if (locked) {
    const status = lockReason === "pending_approval" ? "pending" : "approved";
    return {
      editable: false,
      banner: {
        tone: "locked",
        title: lockBannerText(lockMonthLabel ?? "this month", status),
        body: "A super admin has to send the report back before it can be changed.",
      },
    };
  }

  if (isFuture) {
    return {
      editable: false,
      banner: {
        tone: "future",
        title: "This Mass hasn't happened yet.",
        body: "You can set the session up now and mark everyone once it has run.",
      },
    };
  }

  return { editable: true, banner: null };
}
