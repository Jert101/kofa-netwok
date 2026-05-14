import Link from "next/link";
import { LogoutBar } from "@/components/LogoutBar";

const links = [
  { href: "/admin", label: "Home" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/masses", label: "Masses" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <nav className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-3 gap-1 px-2 py-2 sm:grid-cols-6">
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
