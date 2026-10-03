/**
 * COM-5: the one place a notification is described.
 *
 * Every emitter in the app calls `notify(key, payload)` from `notify.ts`, which reads this file.
 * Nothing else builds a title, decides who receives it, or decides which topic of push it belongs
 * to. The acceptance criterion is a grep: if a route handler composes a notification title by hand,
 * the catalog has been bypassed and this file is wrong.
 *
 * Split from `notify.ts` on purpose. Recipient selection and the copy are the parts worth testing,
 * and they are pure. `notify.ts` is the part that touches the database and the push service, and
 * the parts worth testing are exactly the parts that do not.
 */

import type { Role } from "@/lib/auth/roles";

export const NOTIFY_TOPICS = ["attendance", "announcements", "reports", "liturgy"] as const;
export type NotifyTopic = (typeof NOTIFY_TOPICS)[number];

/**
 * The roles that have an inbox inside the app.
 *
 * One list, because "which roles can read notifications" has been answered three different ways in
 * three different files and all of them were right, which is the definition of a bug that survives
 * review. The super admin has had report notifications since module 05 and had no way to read them
 * for the same reason.
 */
export const INBOX_ROLES = ["admin", "secretary", "super_admin"] as const satisfies readonly Role[];
export type InboxRole = (typeof INBOX_ROLES)[number];

/**
 * A push target.
 *
 * `everyone` is deliberately not the default and never implied by an empty object. The old code
 * pushed to every subscription because there was nowhere to say who; the fix is that a target has
 * to name something, so "send it to everyone" is a decision someone writes down.
 */
export type PushTarget = {
  /** Devices whose subscription recorded this role. */
  roles?: readonly Role[];
  /** Devices that declared this identity. A union with `roles`: both narrowings apply at once. */
  memberIds?: readonly string[];
  /** The device must have this topic enabled. */
  topic?: NotifyTopic;
  /** Every device with the topic enabled, regardless of role. Used for genuinely public news. */
  everyone?: boolean;
};

export type NotifyPayloads = {
  registration_submitted: { member_name: string };
  registration_reviewed: { member_name: string; outcome: "approved" | "rejected" };
  appeal_submitted: { member_name: string; session_label: string };
  /** `label` is what a person reads ("Sunday 5:30 AM Anticipated"); `date` is what the link needs. */
  attendance_updated: { date: string; label: string };
  report_pending: { report_label: string; period_label: string };
  report_reminder: {
    report_label: string;
    period_label: string;
    /** Whole days the report has been waiting, and which reminder this is out of `max_reminders`. */
    waiting_days: number;
    reminder_number: number;
    max_reminders: number;
  };
  report_decided: { role: Role; report_label: string; decision: string; detail?: string };
  /**
   * A published announcement.
   *
   * `audience_roles` and `member_ids` are what the author chose in the composer, resolved before
   * the call. Both may be absent, which means everyone. The catalog decides which of the three it
   * is, rather than the route deciding who to tell, because "roles beat members beat everyone" is a
   * rule about announcements and not about HTTP.
   */
  announcement_posted: {
    announcement_id: string;
    title: string;
    audience_roles?: readonly Role[];
    member_ids?: readonly string[];
    /**
     * The author narrowed the audience, and this is what makes that decision survive resolution.
     *
     * Without it a batch with no members in it resolves to nothing and nothing looks identical to
     * "the author wanted everyone", so the two collapse into one and the second wins. The event that
     * says "batch 9 of 2, and batch 9 has nobody in it" has to send to nobody, not to the parish.
     */
    audience_specified?: boolean;
  };
  /** One event per assignment, so `notify` is called once per person rather than fanned out here. */
  liturgy_reminder: { member_id: string; position_label: string; mass_label: string; date: string };
  /** The officer's advance plan for a Mass, before the day itself. */
  liturgy_planned: { date: string; mass_label: string; slot_count: number };
  /** The published roster for a session, or the fact that it was cleared. */
  liturgy_servers_assigned: { date: string; mass_label: string; slot_count: number };
  /** A finished report that no longer needs anyone's review. */
  report_generated: { role: Role; report_label: string; period_label: string };
  /** A note an officer sent the secretary by hand, rather than a system event. */
  direct_note: { role: Role; title: string; body: string };
  birthday_today: { names: readonly string[] };
};

export type NotifyEventKey = keyof NotifyPayloads;

export type Copy = { title: string; body: string };

export type EventSpec<K extends NotifyEventKey = NotifyEventKey> = {
  /** Roles that get an inbox row. A function for the one event whose recipient is in the payload. */
  inbox: readonly Role[] | ((payload: NotifyPayloads[K]) => readonly Role[]);
  /** Null means inbox only. A function for the two events whose devices depend on the payload. */
  push: PushTarget | null | ((payload: NotifyPayloads[K]) => PushTarget | null);
  /** In-app destination. Null means the notification is informational. */
  link: (payload: NotifyPayloads[K]) => string | null;
  copy: (payload: NotifyPayloads[K]) => Copy;
};

/**
 * The catalog.
 *
 * Copy rules, applied to every entry: no phone numbers, no dates of birth, no payment amounts, no
 * names of people who are not already party to the message. Those bodies end up on a lock screen,
 * which is the least private place in the product.
 */
export const EVENTS: { [K in NotifyEventKey]: EventSpec<K> } = {
  registration_submitted: {
    inbox: ["admin"],
    push: { roles: ["admin"], topic: "announcements" },
    link: () => "/admin/registrations",
    copy: (p: NotifyPayloads["registration_submitted"]) => ({
      title: "New registration",
      body: `${p.member_name} submitted a registration.`,
    }),
  },

  registration_reviewed: {
    inbox: ["admin"],
    // Reviewed is a reply to something already in the inbox, not news worth a lock screen.
    push: null,
    link: () => "/admin/registrations",
    copy: (p: NotifyPayloads["registration_reviewed"]) => ({
      title: "Registration reviewed",
      body: `${p.member_name}'s registration was ${p.outcome}.`,
    }),
  },

  appeal_submitted: {
    inbox: ["admin", "secretary"],
    // Secretaries handle appeals, so their devices are the ones that should buzz. Admins get the
    // inbox row and will see it on their next visit.
    push: { roles: ["secretary"], topic: "attendance" },
    link: () => "/secretary/appeals",
    copy: (p: NotifyPayloads["appeal_submitted"]) => ({
      title: "Appeal submitted",
      body: `${p.member_name} appealed for ${p.session_label}.`,
    }),
  },

  attendance_updated: {
    inbox: [],
    // Roster changes are the parish-wide case: anybody serving that day wants to know.
    push: { everyone: true, topic: "attendance" },
    link: (p: NotifyPayloads["attendance_updated"]) => `/member/day/${encodeURIComponent(p.date)}`,
    copy: (p: NotifyPayloads["attendance_updated"]) => ({
      title: "Attendance updated",
      body: `The roster for ${p.label} changed.`,
    }),
  },

  report_pending: {
    inbox: ["super_admin"],
    push: { roles: ["super_admin"], topic: "reports" },
    link: () => "/super-admin/reports",
    copy: (p: NotifyPayloads["report_pending"]) => ({
      title: "Report awaiting review",
      body: `${p.report_label} for ${p.period_label} needs a decision.`,
    }),
  },

  report_reminder: {
    inbox: ["super_admin", "admin"],
    push: { roles: ["super_admin", "admin"], topic: "reports" },
    link: () => "/super-admin/reports",
    copy: (p: NotifyPayloads["report_reminder"]) => ({
      title: "Report still awaiting review",
      body:
        `${p.report_label} (${p.period_label}) has been waiting ${p.waiting_days} ` +
        `${p.waiting_days === 1 ? "day" : "days"} for your approval. ` +
        `This is reminder ${ordinal(p.reminder_number)} of ${p.max_reminders}. ` +
        `Approve it or reject it with a reason from the Reports console.`,
    }),
  },

  report_decided: {
    // Whichever role raised the report is the one that wants to know the outcome.
    inbox: (p) => [p.role],
    // Push goes wider than the inbox on purpose: a secretary who submitted a report needs to know it
    // was decided even if the inbox row went to the admin who raised it.
    push: { roles: ["super_admin", "admin", "secretary"], topic: "reports" },
    link: () => "/super-admin/reports",
    copy: (p: NotifyPayloads["report_decided"]) => ({
      title: "Report decided",
      body: p.detail ? `${p.report_label} was ${p.decision}. ${p.detail}` : `${p.report_label} was ${p.decision}.`,
    }),
  },

  announcement_posted: {
    inbox: [],
    push: (p) => {
      const roles = p.audience_roles ?? [];
      const members = p.member_ids ?? [];

      // A union, matching the feed: both halves are named, and a device qualifies through either.
      // Precedence here would be the same bug as precedence in the reader, so it does not exist.
      if (roles.length > 0 || members.length > 0) {
        return { roles, memberIds: members, topic: "announcements" };
      }

      // An audience that was chosen and resolved to nobody reaches nobody. `matchesTarget` treats a
      // target with no roles and no members as matching nothing, which is exactly right here, and it
      // is the only reason this branch is safe.
      if (p.audience_specified) return { memberIds: [], topic: "announcements" };

      return { everyone: true, topic: "announcements" };
    },
    link: (p: NotifyPayloads["announcement_posted"]) => `/member/announcements#${p.announcement_id}`,
    copy: (p: NotifyPayloads["announcement_posted"]) => ({
      title: "Announcement",
      body: p.title,
    }),
  },

  liturgy_reminder: {
    inbox: [],
    // The one event that targets a person rather than a role. This is the whole reason module 08
    // records a declared identity on the subscription.
    push: (p) => ({ memberIds: p.member_id ? [p.member_id] : [], topic: "liturgy" }),
    link: () => "/member",
    copy: (p: NotifyPayloads["liturgy_reminder"]) => ({
      title: "You're serving tomorrow",
      body: `${p.position_label}, ${p.mass_label}.`,
    }),
  },

  liturgy_planned: {
    inbox: [],
    // Advance notice for the whole parish: people rearrange their week around it, and a member who
    // does not serve that Mass still needs to know the Mass is covered.
    push: { everyone: true, topic: "announcements" },
    link: (p: NotifyPayloads["liturgy_planned"]) => `/member/day/${encodeURIComponent(p.date)}`,
    copy: (p: NotifyPayloads["liturgy_planned"]) => ({
      title: p.slot_count > 0 ? "Liturgy planned (advance)" : "Liturgy plan cleared",
      body:
        p.slot_count > 0
          ? `${p.mass_label} on ${p.date}: ${p.slot_count} positions planned.`
          : `${p.mass_label} on ${p.date} has no planned positions.`,
    }),
  },

  liturgy_servers_assigned: {
    inbox: [],
    push: { everyone: true, topic: "announcements" },
    link: (p: NotifyPayloads["liturgy_servers_assigned"]) => `/member/day/${encodeURIComponent(p.date)}`,
    copy: (p: NotifyPayloads["liturgy_servers_assigned"]) => ({
      title: p.slot_count > 0 ? "Liturgy servers assigned" : "Liturgy assignments cleared",
      body:
        p.slot_count > 0
          ? `${p.mass_label} on ${p.date}: ${p.slot_count} positions assigned.`
          : `${p.mass_label} on ${p.date} has no assigned positions.`,
    }),
  },

  report_generated: {
    inbox: (p) => [p.role],
    push: (p) => ({ roles: [p.role], topic: "reports" }),
    link: () => "/secretary/reports",
    copy: (p: NotifyPayloads["report_generated"]) => ({
      title: "Monthly report generated",
      body: `${p.report_label} for ${p.period_label} is ready. You can download the PDF from Reports.`,
    }),
  },

  direct_note: {
    inbox: (p) => [p.role],
    // Somebody chose to interrupt this person, which is the exception that earns a push.
    push: (p) => ({ roles: [p.role], topic: "announcements" }),
    link: () => "/secretary/inbox",
    copy: (p: NotifyPayloads["direct_note"]) => ({
      title: p.title,
      body: p.body,
    }),
  },

  birthday_today: {
    inbox: [],
    push: { everyone: true, topic: "announcements" },
    link: () => "/member",
    copy: (p: NotifyPayloads["birthday_today"]) => ({
      title: "Happy birthday",
      body:
        p.names.length === 0
          ? "No birthdays are recorded this week."
          : `Wishing a good day to ${formatNameList(p.names)}.`,
    }),
  },
};

/** The push target for an event, with any payload-derived values filled in. */
export function pushTargetFor<K extends NotifyEventKey>(
  key: K,
  payload: NotifyPayloads[K],
): PushTarget | null {
  const spec = EVENTS[key] as EventSpec<K>;
  return typeof spec.push === "function" ? spec.push(payload) : spec.push;
}

/** The inbox roles for an event. */
export function inboxRolesFor<K extends NotifyEventKey>(
  key: K,
  payload: NotifyPayloads[K],
): readonly Role[] {
  const spec = EVENTS[key] as EventSpec<K>;
  return typeof spec.inbox === "function" ? spec.inbox(payload) : spec.inbox;
}

export function linkFor<K extends NotifyEventKey>(key: K, payload: NotifyPayloads[K]): string | null {
  return (EVENTS[key] as EventSpec<K>).link(payload);
}

export function copyFor<K extends NotifyEventKey>(key: K, payload: NotifyPayloads[K]): Copy {
  return (EVENTS[key] as EventSpec<K>).copy(payload);
}

/** "Ana, Ben and Cora". Plain language beats `[a, b].join()`. */
export function formatNameList(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "1st", "2nd", "3rd", and "11th" for anything past the third. */
function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
