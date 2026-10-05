/**
 * Who may see which member fields.
 *
 * ## The hole this closes
 *
 * `GET /api/admin/members` and `GET /api/admin/members/[id]` both allow member, officer, secretary and
 * treasurer, and both returned one fixed column list: name, date of birth, gender, contact number,
 * batch, active flag, deactivation date and deactivation reason. So any signed-in member could page
 * through the whole parish and read everybody's date of birth, phone number, and the free-text reason
 * an admin typed when they were deactivated. Nothing about being on the roster is secret, but a
 * volunteer's reason for leaving is somebody else's private business, and a phone number is a route to
 * a member's family.
 *
 * ## The rule
 *
 * Three tiers, and the tier is about the job rather than about seniority:
 *
 * - **Full** — admin. Runs the roll, edits these fields, writes the deactivation reasons.
 * - **Contact** — treasurer. Chases dues, so the phone number is the working tool. The *reason* a
 *   member is off the roll is not part of collecting money, so that stays hidden.
 * - **Directory** — secretary and officer. Staff who need to know who is on the roster and whose
 *   birthday it is. No phone numbers: a roster is browsed by far more people than phone numbers should
 *   be handed to.
 * - **Minimal** — member. Name, batch, and whether they are active. This is what the spec asks for by
 *   name: "Member search privacy — search returns minimal fields" (docs §11). The birthday greeting
 *   does not need it either; `GET /api/cron/birthday` matches MM-DD server-side and posts a system
 *   announcement, so no browser ever needs to read a date of birth to wish somebody happy.
 *
 * ## The one exception
 *
 * You always see your own row in full, whatever your role. This mirrors the payments rule in
 * `lib/payments/visibility.ts` on purpose: a member who cannot read their own date of birth, or their
 * own phone number, has to ask the parish office to confirm something about themselves. Identity wins
 * over role, so picking a different actor in the actor picker cannot expose anybody else's row.
 */

import type { Role } from "@/lib/auth/roles";

export type MemberViewer = {
  role: Role;
  /** The member this session is acting as, if the actor picker named one. */
  actorId: string | null;
};

export type MemberScope = {
  dateOfBirth: boolean;
  contactNumber: boolean;
  deactivationReason: boolean;
};

const FULL: MemberScope = {
  dateOfBirth: true,
  contactNumber: true,
  deactivationReason: true,
};

/** Treasurer: everything but the reason somebody is off the roll. */
const CONTACT: MemberScope = { ...FULL, deactivationReason: false };

/** Secretary and officer: the roster and the birthdays, no phone numbers. */
const DIRECTORY: MemberScope = {
  dateOfBirth: true,
  contactNumber: false,
  deactivationReason: false,
};

/** Member: the roster, nothing on it. */
const MINIMAL: MemberScope = {
  dateOfBirth: false,
  contactNumber: false,
  deactivationReason: false,
};

const SCOPES: Record<Role, MemberScope> = {
  admin: FULL,
  super_admin: FULL,
  treasurer: CONTACT,
  secretary: DIRECTORY,
  officer: DIRECTORY,
  member: MINIMAL,
};

/**
 * The fields a viewer may see on *other* people's rows.
 *
 * This is the general tier, not the self-exception, so it is also the right answer for "which columns
 * should this directory offer" — a member's own row being fully visible to them does not mean the
 * Contact column should appear in their table.
 */
export function memberScopeFor(viewer: MemberViewer): MemberScope {
  return SCOPES[viewer.role];
}

/** The scope for one row, with the self-exception applied. */
export function memberScopeForSubject(viewer: MemberViewer, subjectId: string | null): MemberScope {
  if (subjectId !== null && viewer.actorId !== null && viewer.actorId === subjectId) return FULL;
  return SCOPES[viewer.role];
}

/**
 * Which columns a viewer may see, for telling a client which to offer.
 *
 * `gender` is deliberately ungated. It is on the application form as a required field, it is one of the
 * directory's own filters, and separating a roster by it discloses nothing a member has not already
 * told the parish.
 */
export function visibleMemberFields(scope: MemberScope): string[] {
  return [
    "id",
    "full_name",
    "gender",
    "batch",
    "is_active",
    "deactivated_at",
    "created_at",
    ...(scope.dateOfBirth ? ["date_of_birth"] : []),
    ...(scope.contactNumber ? ["contact_number"] : []),
    ...(scope.deactivationReason ? ["deactivation_reason"] : []),
  ];
}

export type RedactableMember = {
  id: string;
  date_of_birth?: string | null;
  gender?: string | null;
  contact_number?: string | null;
  deactivation_reason?: string | null;
  [key: string]: unknown;
};

/**
 * Null out the fields this viewer may not see.
 *
 * Nulled rather than omitted so the client shape is stable, matching `applyLookupVisibility`: a
 * component that expects `contact_number` to exist should get `null` and print an em dash, not
 * `undefined` and a crash. It also means the API never claims a field does not exist, only that this
 * caller may not read it.
 */
export function redactMember<T extends RedactableMember>(row: T, scope: MemberScope): T {
  if (scope.dateOfBirth && scope.contactNumber && scope.deactivationReason) return row;
  return {
    ...row,
    date_of_birth: scope.dateOfBirth ? row.date_of_birth : null,
    contact_number: scope.contactNumber ? row.contact_number : null,
    deactivation_reason: scope.deactivationReason ? row.deactivation_reason : null,
  };
}
