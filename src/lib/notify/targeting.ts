/**
 * COM-3: who a push actually reaches.
 *
 * Pure, and the part of targeting worth being sure about. The old behaviour was one line —
 * select every row from `push_subscriptions` and send to all of them — and it leaked a super
 * admin's report approval to every device in the parish. These rules are the fix, and the tests
 * are the evidence.
 *
 * Three cases that are easy to get wrong and are therefore spelled out here:
 *
 * - A subscription with a null role is from before module 08. It gets public events only, because
 *   there is nothing on it to match a role against and defaulting it into every role-targeted event
 *   would reintroduce the leak.
 * - A device whose topic is off does not get the event even when its role matches. Turning off
 *   `attendance` has to mean it.
 * - `memberIds` and `roles` in one target are a union, not an intersection. A device that declared
 *   an identity *and* has the role is one device and must be sent to once, not twice.
 */

import type { Role } from "@/lib/auth/roles";
import type { NotifyTopic, PushTarget } from "./events";

export type Subscription = {
  id: string;
  role: Role | null;
  member_id: string | null;
  topics: readonly string[] | null;
};

/** Columns needed to decide, and nothing else. */
export const SUBSCRIPTION_TARGET_COLUMNS = "id, role, member_id, topics";

/**
 * Whether a device has a topic enabled.
 *
 * A null or empty topic list means every topic. That is the migration default wearing a different
 * hat: pre-module-08 rows and devices that have never set topics still expect the old behaviour,
 * and an absent list is not the same as a device that turned something off.
 */
export function hasTopic(subscription: Subscription, topic: NotifyTopic | undefined): boolean {
  if (!topic) return true;
  const topics = subscription.topics;
  if (!topics || topics.length === 0) return true;
  return topics.includes(topic);
}

/** Whether a subscription matches the audience part of a target, ignoring topics. */
export function matchesTarget(subscription: Subscription, target: PushTarget): boolean {
  if (target.everyone) return true;

  const roles = target.roles ?? [];
  const memberIds = target.memberIds ?? [];

  // A target that names neither a role nor a person is not a broadcast; it matches nothing. This is
  // the guard that stops `{}` from silently meaning "everyone", which is the bug being fixed.
  if (roles.length === 0 && memberIds.length === 0) return false;

  // Member and role are a union. A device that both declared an identity and has the role is one
  // device and must not be selected twice.
  if (memberIds.length > 0 && subscription.member_id && memberIds.includes(subscription.member_id)) {
    return true;
  }
  if (roles.length > 0 && subscription.role && roles.includes(subscription.role)) return true;

  // Anything left, including a legacy device with no role and no identity, matches nothing: there is
  // nothing on it to compare against a named target.
  return false;
}

/**
 * Every subscription that should receive this push, in the order the table returned them.
 *
 * Generic so the caller keeps its own fields. `sendPushToTarget` selects the endpoint and the keys
 * in the same query, and narrowing the result back to `Subscription` here would throw them away and
 * force a second round trip to look them up.
 */
export function selectTargets<S extends Subscription>(
  subscriptions: readonly S[],
  target: PushTarget,
): S[] {
  return subscriptions.filter((s) => hasTopic(s, target.topic) && matchesTarget(s, target));
}

/** Device ids to delete after a send, given the failures the push service reported. */
export function deadSubscriptionIds(
  subscriptions: readonly Subscription[],
  failures: ReadonlyMap<string, number | undefined>,
): string[] {
  const out: string[] = [];
  for (const sub of subscriptions) {
    const status = failures.get(sub.id);
    // 404 and 410 are the push service saying this endpoint will never work again: gone or no
    // longer valid. Anything else is a transient problem and the subscription is kept, because
    // deleting on a 500 would silently unsubscribe the whole parish on a bad afternoon.
    if (status === 404 || status === 410) out.push(sub.id);
  }
  return out;
}

/**
 * The superset of roles a target can reach, for a query filter.
 *
 * Returns null whenever the role column is not a safe predicate, because a filter that drops the rows
 * the target is meant to reach is worse than no filter: it sends a targeted announcement to fewer
 * people than the author chose, and reports success.
 *
 * Null in three cases. Public, because there is no narrowing. Member-only, because the useful
 * predicate is the member column. And mixed, because a target with both halves is a union, and
 * `role = in.(...)` would silently discard every device that qualified by identity instead.
 */
export function roleFilterFor(target: PushTarget): readonly Role[] | null {
  if (target.everyone) return null;
  const roles = target.roles ?? [];
  const memberIds = target.memberIds ?? [];
  if (roles.length === 0 && memberIds.length === 0) return [];
  if (memberIds.length > 0) return null;
  return roles;
}
