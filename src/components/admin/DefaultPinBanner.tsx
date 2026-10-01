import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { ROLE_LABEL } from "@/lib/nav/config";
import { isRole, type Role } from "@/lib/auth/roles";

function parseRoles(raw: string | undefined): Role[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Role => isRole(s));
}

/**
 * AUTH-1: forces the default PIN off. The role list comes from a cookie written at admin
 * login, so this renders no bcrypt work of its own and cannot be dismissed.
 */
export function DefaultPinBanner({ roles }: { roles: string | undefined }) {
  const parsed = parseRoles(roles);
  if (parsed.length === 0) return null;

  return (
    <div
      role="alert"
      className="border-b border-[var(--danger)] bg-[var(--danger)] px-4 py-3 text-[var(--danger)]"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <ShieldAlert aria-hidden className="size-5 shrink-0" />
        <p className="font-semibold">Default PINs are still in use for:</p>
        <p className="font-medium">{parsed.map((r) => ROLE_LABEL[r]).join(", ")}.</p>
        <p>Change them now.</p>
        <Link
          href="/admin/security"
          className="ml-auto min-h-11 rounded-xl border border-[var(--danger)] px-3 py-2 font-semibold underline"
        >
          Change PINs
        </Link>
      </div>
    </div>
  );
}
