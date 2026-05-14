import { LogoutBar } from "@/components/LogoutBar";

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pb-10 pt-3 sm:px-4">{children}</div>
    </div>
  );
}
