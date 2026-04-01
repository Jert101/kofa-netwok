import Link from "next/link";
import { LogoutBar } from "@/components/LogoutBar";

export default function SecretaryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-20">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <nav className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[var(--surface)] px-2 py-2">
        <div className="mx-auto flex w-full max-w-6xl justify-around sm:justify-center sm:gap-4">
          <Link
            href="/secretary"
            className="min-h-12 min-w-[4.5rem] rounded-xl px-3 py-2 text-center text-sm font-medium text-[var(--accent)]"
          >
            Calendar
          </Link>
          <Link
            href="/secretary/inbox"
            className="min-h-12 min-w-[4.5rem] rounded-xl px-3 py-2 text-center text-sm font-medium text-[var(--accent)]"
          >
            Inbox
          </Link>
          <Link
            href="/secretary/reports"
            className="min-h-12 min-w-[4.5rem] rounded-xl px-3 py-2 text-center text-sm font-medium text-[var(--accent)]"
          >
            Reports
          </Link>
        </div>
      </nav>
    </div>
  );
}
