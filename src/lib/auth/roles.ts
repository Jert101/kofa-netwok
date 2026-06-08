export type Role = "admin" | "secretary" | "member" | "officer" | "treasurer";

export const ROLE_PATH: Record<Role, string> = {
  admin: "/admin",
  secretary: "/secretary",
  member: "/member",
  officer: "/officer",
  treasurer: "/treasurer",
};

export function isRole(s: string): s is Role {
  return s === "admin" || s === "secretary" || s === "member" || s === "officer" || s === "treasurer";
}
