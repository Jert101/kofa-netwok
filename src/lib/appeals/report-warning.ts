/**
 * APL-8: what report generation should tell the secretary about outstanding appeals.
 *
 * Kept out of the route so the warning can be tested without a database, and separate
 * from `report-lock.ts` on purpose. The lock asks "may this month still change"; this
 * asks "is there work nobody has decided yet". Those are different questions, and
 * folding them together previously meant a month could be closed with appeals still
 * waiting, which is the failure APL-8 exists to prevent.
 */

export type PendingAppealMonth = {
  monthStart: string;
  monthEnd: string;
  pendingCount: number;
  /** How many distinct Masses are affected, so the warning can be concrete. */
  sessionCount: number;
};

export type AppealWarning =
  | { blocking: false; pendingCount: 0 }
  | { blocking: true; pendingCount: number; message: string };

/**
 * Pending appeals in a month mean the report is about to disagree with the appeals.
 *
 * Warning rather than blocking: the secretary is the one who decides, and refusing to
 * generate would leave a month that cannot be corrected either. The route expires the
 * stale appeals and requires the caller's explicit confirmation instead, which leaves
 * the decision with the person who can see the list.
 */
export function describePendingAppeals(month: PendingAppealMonth): AppealWarning {
  if (month.pendingCount <= 0) return { blocking: false, pendingCount: 0 };

  const masses = month.sessionCount === 1 ? "1 Mass" : `${month.sessionCount} Masses`;
  const appeals = month.pendingCount === 1 ? "1 appeal" : `${month.pendingCount} appeals`;

  return {
    blocking: true,
    pendingCount: month.pendingCount,
    message:
      `${appeals} for ${masses} in this month ${month.pendingCount === 1 ? "has" : "have"} not been ` +
      `reviewed yet. Generating the report now closes the month and settles ${month.pendingCount === 1 ? "it" : "them"} ` +
      `as declined. Review the appeals first, or confirm to continue.`,
  };
}

/** True when the caller has answered the warning. */
export function isConfirmed(flag: string | null): boolean {
  return flag === "1" || flag === "true";
}
