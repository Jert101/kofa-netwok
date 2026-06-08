import Link from "next/link";
import { LogoutBar } from "@/components/LogoutBar";

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <LogoutBar />
      <nav className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="mx-auto flex max-w-6xl gap-4 text-sm font-medium">
          <Link href="/member" className="text-[var(--accent)]">Home</Link>
          <Link href="/member/payments" className="text-[var(--text)]">Payments</Link>
        </div>
      </nav>
      <div className="mx-auto w-full max-w-6xl px-3 pb-10 pt-3 sm:px-4">{children}</div>
    </div>
  );
}
