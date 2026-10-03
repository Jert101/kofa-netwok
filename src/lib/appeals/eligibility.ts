/**
 * APL-6 / unit tests: who cannot be appealed for on a given Mass.
 *
 * Extracted from the submit route because this is a rule, not plumbing. The inputs are
 * sets keyed by member id, and the answer has to be explainable — the form turns it into
 * "already on the list or already waiting", and a member who appealed successfully for
 * the same person last month must not be told they cannot appeal at all.
 *
 * "Previously rejected" is therefore allowed, and is the reason this module exists as
 * written: a rejected appeal is a decision, not a lock. Refusing a second appeal would
 * make the first decision permanent, which is the opposite of what the history in APL-3
 * exists for.
 */

export type AppealEligibilityReason = "on_roster" | "already_pending" | "inactive";

export type AppealEligibilityInput = {
  /** The member ids the member asked to appeal for, in the order they selected them. */
  requested: readonly string[];
  /** Members already recorded as present for this session. */
  onRoster?: readonly string[];
  /** Members who already have a pending appeal for this session. */
  pending?: readonly string[];
  /** Inactive members, who cannot be appealed for at all. */
  inactive?: readonly string[];
};

export type AppealEligibility = {
  /** Requested ids that may be appealed for, de-duplicated, in request order. */
  eligible: string[];
  /** Requested ids that cannot, with the reason, for the server's message. */
  blocked: { member_id: string; reason: AppealEligibilityReason }[];
};

export function decideAppealEligibility(input: AppealEligibilityInput): AppealEligibility {
  const onRoster = new Set(input.onRoster ?? []);
  const pending = new Set(input.pending ?? []);
  const inactive = new Set(input.inactive ?? []);

  const eligible: string[] = [];
  const blocked: AppealEligibility["blocked"] = [];
  const seen = new Set<string>();

  for (const memberId of input.requested) {
    // The route de-duplicates before calling, but doing it here too means the reason list
    // cannot contain the same member twice, which the UI renders as a list of names.
    if (seen.has(memberId)) continue;
    seen.add(memberId);

    // Order matters for the message: on_roster first, because it is the most common and
    // the most obvious. Someone who is both present and inactive hears the truthful, less
    // alarming reason.
    if (onRoster.has(memberId)) blocked.push({ member_id: memberId, reason: "on_roster" });
    else if (pending.has(memberId)) blocked.push({ member_id: memberId, reason: "already_pending" });
    else if (inactive.has(memberId)) blocked.push({ member_id: memberId, reason: "inactive" });
    else eligible.push(memberId);
  }

  return { eligible, blocked };
}

/**
 * The single message the member sees for any of the blocked reasons.
 *
 * One sentence for two of the three cases, because the member cannot act on either one
 * differently — picking someone already there, or someone already waiting, changes
 * nothing they are able to do. Inactive members get their own message, since that one is
 * not visible on the screen and a secretary may have to explain it.
 */
export function explainBlocked(entries: AppealEligibility["blocked"]): string {
  if (entries.some((e) => e.reason === "inactive")) {
    return "One of the selected members is no longer active.";
  }

  return "One or more selected names are already on the attendance list or already have a pending appeal for this Mass.";
}
