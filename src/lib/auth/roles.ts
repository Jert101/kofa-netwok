export type Role = "admin" | "secretary" | "member" | "officer" | "treasurer" | "super_admin";

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


