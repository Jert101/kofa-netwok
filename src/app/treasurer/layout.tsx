import Link from "next/link";
import { LogoutBar } from "@/components/LogoutBar";

const links = [
  { href: "/treasurer", label: "Home" },
  { href: "/treasurer/payment-structures", label: "Payment Structures" },
  { href: "/treasurer/payments", label: "Payments" },
] as const;

export default function TreasurerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <nav className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-4 px-2 py-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="min-h-11 rounded-lg px-4 py-2 text-center text-sm font-medium leading-tight text-[var(--accent)]"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
