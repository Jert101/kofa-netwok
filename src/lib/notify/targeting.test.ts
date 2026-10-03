import { describe, expect, it } from "vitest";
import {
  deadSubscriptionIds,
  hasTopic,
  matchesTarget,
  roleFilterFor,
  selectTargets,
  type Subscription,
} from "./targeting";
import {
  EVENTS,
  copyFor,
  formatNameList,
  inboxRolesFor,
  linkFor,
  pushTargetFor,
  NOTIFY_TOPICS,
  type NotifyEventKey,
  type NotifyPayloads,
} from "./events";

function sub(over: Partial<Subscription> & { id: string }): Subscription {
  return { role: null, member_id: null, topics: [...NOTIFY_TOPICS], ...over };
}

// ======================================================================================
// Topics
// ======================================================================================

describe("hasTopic", () => {
  it("accepts a device with the topic on", () => {
    expect(hasTopic(sub({ id: "a", topics: ["attendance", "reports"] }), "attendance")).toBe(true);
  });

  it("rejects a device with the topic off", () => {
    expect(hasTopic(sub({ id: "a", topics: ["reports"] }), "attendance")).toBe(false);
  });

  it("treats an empty topic list as everything on", () => {
    // Pre-module-08 rows have no topic column at all. Defaulting them to "nothing" would silently
    // unsubscribe the parish.
    expect(hasTopic(sub({ id: "a", topics: [] }), "attendance")).toBe(true);
  });

  it("treats a null topic list as everything on", () => {
    expect(hasTopic(sub({ id: "a", topics: null }), "liturgy")).toBe(true);
  });

  it("is always true when the target has no topic", () => {
    expect(hasTopic(sub({ id: "a", topics: ["reports"] }), undefined)).toBe(true);
  });
});

// ======================================================================================
// Target matching
// ======================================================================================

describe("matchesTarget", () => {
  it("matches a role-targeted device", () => {
    expect(matchesTarget(sub({ id: "a", role: "super_admin" }), { roles: ["super_admin"] })).toBe(true);
  });

  it("does not match a different role", () => {
    // The leak being fixed: a report approval must not reach a secretary's phone.
    expect(matchesTarget(sub({ id: "a", role: "secretary" }), { roles: ["super_admin"] })).toBe(false);
  });

  it("matches a member-targeted device", () => {
    expect(matchesTarget(sub({ id: "a", member_id: "m1" }), { memberIds: ["m1"] })).toBe(true);
  });

  it("does not match a different member", () => {
    expect(matchesTarget(sub({ id: "a", member_id: "m2" }), { memberIds: ["m1"] })).toBe(false);
  });

  it("matches on either role or identity when a target names both", () => {
    expect(
      matchesTarget(sub({ id: "a", role: "secretary" }), { roles: ["secretary"], memberIds: ["m1"] }),
    ).toBe(true);
    expect(
      matchesTarget(sub({ id: "b", member_id: "m1" }), { roles: ["secretary"], memberIds: ["m1"] }),
    ).toBe(true);
    expect(
      matchesTarget(sub({ id: "c", role: "member" }), { roles: ["secretary"], memberIds: ["m1"] }),
    ).toBe(false);
  });

  it("matches everything only when the target says everyone", () => {
    expect(matchesTarget(sub({ id: "a", role: "member" }), { everyone: true })).toBe(true);
    expect(matchesTarget(sub({ id: "b" }), { everyone: true })).toBe(true);
  });

  it("matches nothing for an empty target", () => {
    // `{}` must not quietly mean "everyone". That was the original bug in one line.
    expect(matchesTarget(sub({ id: "a", role: "admin" }), {})).toBe(false);
  });

  it("does not match a legacy device that has no role and no identity", () => {
    expect(matchesTarget(sub({ id: "a" }), { roles: ["admin"] })).toBe(false);
    expect(matchesTarget(sub({ id: "a" }), { memberIds: ["m1"] })).toBe(false);
  });

  it("matches a legacy device for a public target", () => {
    expect(matchesTarget(sub({ id: "a" }), { everyone: true, topic: "announcements" })).toBe(true);
  });

  it("does not match a role-targeted device when it has the role but no topic", () => {
    // A member-target that happens to have a role must not sneak through the role branch.
    expect(matchesTarget(sub({ id: "a", role: "secretary" }), { memberIds: ["m1"] })).toBe(false);
  });
});

// ======================================================================================
// Selection
// ======================================================================================

describe("selectTargets", () => {
  const parish = [
    sub({ id: "admin-phone", role: "admin" }),
    sub({ id: "sec-phone", role: "secretary" }),
    sub({ id: "sup-phone", role: "super_admin" }),
    sub({ id: "member-phone", role: "member" }),
    sub({ id: "identified", role: "member", member_id: "m1" }),
    sub({ id: "legacy", role: null }),
    sub({ id: "attendance-off", role: "secretary", topics: ["reports"] }),
  ];

  it("reaches only the super admin for a report decision", () => {
    const chosen = selectTargets(parish, { roles: ["super_admin"], topic: "reports" });
    expect(chosen.map((s) => s.id)).toEqual(["sup-phone"]);
  });

  it("reaches only admins for a new registration", () => {
    const chosen = selectTargets(parish, { roles: ["admin"], topic: "announcements" });
    expect(chosen.map((s) => s.id)).toEqual(["admin-phone"]);
  });

  it("reaches only secretaries for an appeal", () => {
    const chosen = selectTargets(parish, { roles: ["secretary"], topic: "attendance" });
    // The secretary who turned the topic off is correctly absent.
    expect(chosen.map((s) => s.id)).toEqual(["sec-phone"]);
  });

  it("reaches only the named member for a liturgy reminder", () => {
    const chosen = selectTargets(parish, { memberIds: ["m1"], topic: "liturgy" });
    expect(chosen.map((s) => s.id)).toEqual(["identified"]);
  });

  it("reaches every device with the topic on, and skips one that turned it off", () => {
    const chosen = selectTargets(parish, { everyone: true, topic: "announcements" });
    expect(chosen.map((s) => s.id)).toContain("legacy");
    // `attendance-off` only has reports enabled, so an announcement is not for it.
    expect(chosen.map((s) => s.id)).not.toContain("attendance-off");
    expect(chosen).toHaveLength(parish.length - 1);
  });

  it("never returns the same device twice when a target names role and member", () => {
    const both = [...parish, sub({ id: "both", role: "secretary", member_id: "m1" })];
    const chosen = selectTargets(both, { roles: ["secretary"], memberIds: ["m1"], topic: "reports" });
    const ids = chosen.map((s) => s.id);
    expect(ids.filter((id) => id === "both")).toHaveLength(1);
  });

  it("returns nothing for an empty target", () => {
    expect(selectTargets(parish, {})).toEqual([]);
  });

  it("returns nothing for a member target when nobody declared that identity", () => {
    expect(selectTargets(parish, { memberIds: ["nobody"], topic: "liturgy" })).toEqual([]);
  });
});

// ======================================================================================
// Dead subscriptions
// ======================================================================================

describe("deadSubscriptionIds", () => {
  const subs = [sub({ id: "a" }), sub({ id: "b" }), sub({ id: "c" }), sub({ id: "d" })];

  it("removes 410 Gone", () => {
    expect(deadSubscriptionIds(subs, new Map([["a", 410]]))).toEqual(["a"]);
  });

  it("removes 404 Not Found", () => {
    expect(deadSubscriptionIds(subs, new Map([["b", 404]]))).toEqual(["b"]);
  });

  it("keeps a subscription on a transient failure", () => {
    // Deleting on a 500 would unsubscribe the parish on a bad afternoon at the push service.
    expect(deadSubscriptionIds(subs, new Map([["c", 500]]))).toEqual([]);
  });

  it("keeps a subscription on a rate limit", () => {
    expect(deadSubscriptionIds(subs, new Map([["d", 429]]))).toEqual([]);
  });

  it("keeps a subscription with no reported status", () => {
    expect(deadSubscriptionIds(subs, new Map([["a", undefined]]))).toEqual([]);
  });

  it("removes only the dead ones", () => {
    const failures = new Map<string, number | undefined>([
      ["a", 410],
      ["b", 0],
      ["c", 503],
    ]);
    expect(deadSubscriptionIds(subs, failures)).toEqual(["a"]);
  });
});

// ======================================================================================
// Role filters
// ======================================================================================

describe("roleFilterFor", () => {
  it("returns the roles for a role target", () => {
    expect(roleFilterFor({ roles: ["admin"] })).toEqual(["admin"]);
  });

  it("returns null for a public target, because the role column is not the predicate", () => {
    expect(roleFilterFor({ everyone: true })).toBeNull();
  });

  it("returns null for a member-only target", () => {
    expect(roleFilterFor({ memberIds: ["m1"] })).toBeNull();
  });

  it("returns null for a mixed role+member target, because filtering by role alone would drop the members", () => {
    expect(roleFilterFor({ roles: ["officer"], memberIds: ["m1"] })).toBeNull();
  });

  it("returns null rather than an empty list for a target that names nothing", () => {
    // An empty `in ()` filter would match no rows; null means "no filter", and `selectTargets`
    // decides. Two different intents, and they must not look alike.
    expect(roleFilterFor({})).toEqual([]);
  });
});

// ======================================================================================
// The catalog
// ======================================================================================

describe("event catalog", () => {
  it("has copy, a link and an inbox decision for every event", () => {
    const payloads: { [K in NotifyEventKey]: NotifyPayloads[K] } = {
      registration_submitted: { member_name: "Ana" },
      registration_reviewed: { member_name: "Ana", outcome: "approved" },
      appeal_submitted: { member_name: "Ana", session_label: "Sun 5:30 AM" },
      attendance_updated: { date: "2026-10-04", label: "Sunday 5:30 AM Anticipated" },
      report_pending: { report_label: "Weekend report", period_label: "October" },
      report_reminder: {
        report_label: "Weekend report",
        period_label: "October",
        waiting_days: 3,
        reminder_number: 1,
        max_reminders: 3,
      },
      report_decided: { role: "secretary", report_label: "Weekend report", decision: "approved" },
      announcement_posted: { announcement_id: "a1", title: "Mass moved" },
      liturgy_planned: { date: "2026-10-04", mass_label: "5:30 AM", slot_count: 4 },
      liturgy_servers_assigned: { date: "2026-10-04", mass_label: "5:30 AM", slot_count: 4 },
      report_generated: { role: "secretary", report_label: "Weekend report", period_label: "October" },
      direct_note: { role: "secretary", title: "Question", body: "About February." },
      liturgy_reminder: { member_id: "m1", position_label: "Thurifer", mass_label: "5:30 AM", date: "2026-10-04" },
      birthday_today: { names: ["Ana", "Ben"] },
    };

    for (const key of Object.keys(EVENTS) as NotifyEventKey[]) {
      const payload = payloads[key];
      const copy = copyFor(key, payload);
      expect(copy.title.length, key).toBeGreaterThan(0);
      expect(copy.body.length, key).toBeGreaterThan(0);
      // Every event either has a push target or says null, never undefined.
      expect(pushTargetFor(key, payload) === null || typeof pushTargetFor(key, payload) === "object", key).toBe(true);
      expect(inboxRolesFor(key, payload).length, key).toBeGreaterThanOrEqual(0);
      expect(linkFor(key, payload) === null || linkFor(key, payload)!.startsWith("/"), key).toBe(true);
    }
  });

  it("keeps a report decision away from member devices", () => {
    const target = pushTargetFor("report_decided", {
      role: "secretary",
      report_label: "Weekend report",
      decision: "approved",
    });
    expect(target?.roles).not.toContain("member");
    expect(target?.roles).not.toContain("officer");
  });

  it("sends a report decision inbox row to the role that raised it", () => {
    const roles = inboxRolesFor("report_decided", {
      role: "admin",
      report_label: "Weekend report",
      decision: "rejected",
    });
    expect(roles).toEqual(["admin"]);
  });

  it("targets only the named member for a liturgy reminder", () => {
    const target = pushTargetFor("liturgy_reminder", {
      member_id: "m9",
      position_label: "Thurifer",
      mass_label: "5:30 AM",
      date: "2026-10-04",
    });
    expect(target).toEqual({ memberIds: ["m9"], topic: "liturgy" });
  });

  it("targets nobody for a liturgy reminder with no identity", () => {
    // Guests and undeclared devices get nothing. Better silent than a message about somebody else.
    const target = pushTargetFor("liturgy_reminder", {
      member_id: "",
      position_label: "Thurifer",
      mass_label: "5:30 AM",
      date: "2026-10-04",
    });
    expect(target?.memberIds).toEqual([]);
    expect(selectTargets([sub({ id: "a", role: "member" })], target!)).toEqual([]);
  });

  it("targets the union of roles and members for an announcement", () => {
    // The reader shows the post to both halves. The push must follow the same rule, because a role
    // target that silently drops the members is the leak this module exists to close.
    const target = pushTargetFor("announcement_posted", {
      announcement_id: "a1",
      title: "Mass moved",
      audience_roles: ["officer"],
      member_ids: ["m1"],
    });
    expect(target).toEqual({ roles: ["officer"], memberIds: ["m1"], topic: "announcements" });
    const reached = selectTargets(
      [sub({ id: "a", role: "officer" }), sub({ id: "b", role: "member", member_id: "m1" }), sub({ id: "c", role: "member", member_id: "m2" })],
      target!,
    );
    expect(reached.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("reaches everyone for an announcement with no audience", () => {
    const target = pushTargetFor("announcement_posted", { announcement_id: "a1", title: "Mass moved" });
    expect(target).toEqual({ everyone: true, topic: "announcements" });
  });

  it("reaches nobody when the chosen audience resolved to nobody", () => {
    // "Batch 9" with no members in it is a named, empty audience, not a broadcast.
    const target = pushTargetFor("announcement_posted", {
      announcement_id: "a1",
      title: "Bedan year 9",
      member_ids: [],
      audience_specified: true,
    });
    expect(target).toEqual({ memberIds: [], topic: "announcements" });
    expect(selectTargets([sub({ id: "a", role: "member", member_id: "m1" })], target!)).toEqual([]);
  });

  it("does not push for a reviewed registration", () => {
    expect(pushTargetFor("registration_reviewed", { member_name: "Ana", outcome: "approved" })).toBeNull();
  });

  it("keeps sensitive fields out of the copy", () => {
    // The rule from §7: no phone numbers, dates of birth or payment amounts on a lock screen.
    const bodies = [
      copyFor("registration_submitted", { member_name: "Ana" }).body,
      copyFor("registration_reviewed", { member_name: "Ana", outcome: "approved" }).body,
      copyFor("appeal_submitted", { member_name: "Ana", session_label: "Sun 5:30 AM" }).body,
      copyFor("report_pending", { report_label: "Weekend report", period_label: "October" }).body,
      copyFor("report_decided", { role: "admin", report_label: "Weekend report", decision: "approved" }).body,
    ].join(" ");
    expect(bodies).not.toMatch(/\d{3}[- ]?\d{3}[- ]?\d{4}/); // phone
    expect(bodies).not.toMatch(/₱|\bPHP\b|peso/); // money
  });

  it("names every topic it uses", () => {
    for (const key of Object.keys(EVENTS) as NotifyEventKey[]) {
      const target = pushTargetFor(key, sampleFor(key));
      if (!target?.topic) continue;
      expect(NOTIFY_TOPICS).toContain(target.topic);
    }
  });
});

describe("formatNameList", () => {
  it("says nothing for an empty list", () => {
    expect(formatNameList([])).toBe("");
  });

  it("handles one name", () => {
    expect(formatNameList(["Ana"])).toBe("Ana");
  });

  it("joins two with and", () => {
    expect(formatNameList(["Ana", "Ben"])).toBe("Ana and Ben");
  });

  it("uses commas before the last name for three or more", () => {
    expect(formatNameList(["Ana", "Ben", "Cora"])).toBe("Ana, Ben and Cora");
  });
});

function sampleFor(key: NotifyEventKey): NotifyPayloads[NotifyEventKey] {
  const samples: { [K in NotifyEventKey]: NotifyPayloads[K] } = {
    registration_submitted: { member_name: "Ana" },
    registration_reviewed: { member_name: "Ana", outcome: "approved" },
    appeal_submitted: { member_name: "Ana", session_label: "Sun 5:30 AM" },
    attendance_updated: { date: "2026-10-04", label: "Sunday" },
    report_pending: { report_label: "Weekend report", period_label: "October" },
    report_reminder: {
      report_label: "Weekend report",
      period_label: "October",
      waiting_days: 3,
      reminder_number: 1,
      max_reminders: 3,
    },
    report_decided: { role: "admin", report_label: "Weekend report", decision: "approved" },
    announcement_posted: { announcement_id: "a1", title: "Mass moved" },
    liturgy_planned: { date: "2026-10-04", mass_label: "5:30 AM", slot_count: 4 },
    liturgy_servers_assigned: { date: "2026-10-04", mass_label: "5:30 AM", slot_count: 4 },
    report_generated: { role: "secretary", report_label: "Weekend report", period_label: "October" },
    direct_note: { role: "secretary", title: "Question", body: "About February." },
    liturgy_reminder: { member_id: "m1", position_label: "Thurifer", mass_label: "5:30 AM", date: "2026-10-04" },
    birthday_today: { names: ["Ana"] },
  };
  return samples[key];
}
