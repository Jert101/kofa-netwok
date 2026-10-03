/**
 * PAY-7: who may see which payment numbers.
 *
 * Decision D-9 in the module doc asks for confirmation of the recommendation "only the treasurer and
 * admin see all balances", and this file implements that recommendation. It is called out in the
 * handoff notes because it is a policy decision rather than a bug fix.
 *
 * ## The hole this closes
 *
 * `GET /api/admin/payments` allowed member, officer and secretary, and `PaymentLookup` was mounted
 * verbatim on all four role pages. Any signed-in member could type any other member's name and read
 * their exact peso amounts. Spec §P6 named this; nothing stopped it.
 *
 * ## The rule
 *
 * Full amounts are for the treasurer and admin. Everyone else sees structure names and a plain
 * "paid up / not paid up", with no peso figure at all. Officers and secretaries do not get the
 * amounts either: a secretary who knows that Ana owes ₱1,200 learns something about Ana's household
 * that the parish has no reason to publish to the secretary.
 *
 * One exception, and it is narrow: a signed-in person may always see their own figures, because it is
 * their own money and the alternative is asking them to ring the treasurer to be told what they owe.
 */

import type { Role } from "@/lib/auth/roles";

/** Roles that see peso amounts for anybody. */
export const BALANCE_ROLES: readonly Role[] = ["treasurer", "admin"];

export function canSeeAmountsFor(viewer: { role: Role; actorId: string | null }, subjectId: string): boolean {
  if (BALANCE_ROLES.includes(viewer.role)) return true;
  // Identity wins over role, so switching to an actor picker cannot accidentally hide someone's own
  // balance from themselves.
  return viewer.actorId !== null && viewer.actorId === subjectId;
}

export type LookupEntry = {
  structureId: string;
  structureName: string;
  /** Only ever populated when the viewer may see amounts. Null means "you may not see this number". */
  amount: string | null;
  paid: string | null;
  remaining: string | null;
  credit: string | null;
  /**
   * The bit everyone may see: has this member settled this structure?
   *
   * A word rather than a number on purpose. "Not paid up" is a fact the parish needs; "₱840 short" is
   * a fact about somebody's finances, and the two are not the same disclosure.
   */
  settled: boolean;
  isActive: boolean;
};

export type LookupResult = {
  memberId: string;
  fullName: string;
  /** True when the amounts above are real figures rather than hidden. */
  amountsVisible: boolean;
  entries: LookupEntry[];
};

/**
 * Strip the numbers from a lookup result for a viewer who may not see them.
 *
 * Nulled rather than omitted, so the client shape is stable: a component that renders
 * "₱840 remaining" would otherwise render an empty string instead of saying nothing, which looks like
 * a bug rather than a decision.
 */
export function applyLookupVisibility(
  entries: readonly LookupEntry[],
  viewer: { role: Role; actorId: string | null },
  subjectId: string,
): { entries: LookupEntry[]; amountsVisible: boolean } {
  const visible = canSeeAmountsFor(viewer, subjectId);
  if (visible) return { entries: [...entries], amountsVisible: true };
  return {
    entries: entries.map((e) => ({ ...e, amount: null, paid: null, remaining: null, credit: null })),
    amountsVisible: false,
  };
}

/**
 * One sentence for the limited view, so the four pages that replaced PaymentLookup say the same
 * thing.
 */
export function lookupVisibilityNote(amountsVisible: boolean, isSelf: boolean): string {
  if (amountsVisible && isSelf) return "Your own payment record.";
  if (amountsVisible) return "Full payment record.";
  return "Whether this member is paid up. Amounts are kept by the treasurer.";
}