import { LogoutBar } from "@/components/LogoutBar";
import Link from "next/link";

const links = [
  { href: "/super-admin", label: "Dashboard" },
  { href: "/super-admin/reports", label: "Reports" },
] as const;

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <nav className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-4 gap-1 px-2 py-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="min-h-11 rounded-lg px-1 py-2 text-center text-xs font-medium leading-tight text-[var(--accent)] sm:text-sm"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}