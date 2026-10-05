export type Role = "admin" | "secretary" | "member" | "officer" | "treasurer" | "super_admin";

export const ROLE_ORDER: readonly Role[] = [
  "admin",
  "secretary",
  "member",
  "officer",
  "treasurer",
  "super_admin",
];

export const ROLE_PATH: Record<Role, string> = {
  admin: "/admin",
  secretary: "/secretary",
  member: "/member",
  officer: "/officer",
  treasurer: "/treasurer",
  super_admin: "/super-admin",
};

export function isRole(s: string): s is Role {
  return (
    s === "admin" ||
    s === "secretary" ||
    s === "member" ||
    s === "officer" ||
    s === "treasurer" ||
    s === "super_admin"
  );
}

/**
 * Which sections a signed-in role may open, in sidebar order.
 *
 * Four roles reach only themselves. The two that reach further are the ones a person would otherwise
 * have to sign out of and back into: the admin who has to look at what the treasurer sees before
 * approving a payment structure, and the super admin who has to see the whole system. `admin` stops at
 * `super_admin` on purpose -- the super admin namespace is the report-approval gate, and letting the
 * role below it open that namespace would quietly remove the gate.
 *
 * This is the one answer to "may this session open this section?". The edge middleware, the role
 * layouts, the API guard and the sidebar all read it, because three of them answering the same
 * question three different ways is how a role ends up with a link it cannot follow.
 */
export const ROLE_REACH: Record<Role, readonly Role[]> = {
  admin: ["admin", "secretary", "member", "officer", "treasurer"],
  super_admin: ["admin", "secretary", "member", "officer", "treasurer", "super_admin"],
  secretary: ["secretary"],
  member: ["member"],
  officer: ["officer"],
  treasurer: ["treasurer"],
};

/** Every path prefix that belongs to a role, so the middleware can ask `canReach` instead of
 * re-deriving "which section is this path in" with a hard-coded `if` per role. */
export const ROLE_SECTIONS: readonly { prefix: string; role: Role }[] = [
  { prefix: "/admin", role: "admin" },
  { prefix: "/secretary", role: "secretary" },
  { prefix: "/member", role: "member" },
  { prefix: "/officer", role: "officer" },
  { prefix: "/treasurer", role: "treasurer" },
  { prefix: "/super-admin", role: "super_admin" },
];

export function canReach(sessionRole: Role, section: Role): boolean {
  return ROLE_REACH[sessionRole].includes(section);
}


