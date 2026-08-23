import { LogoutBar } from "@/components/LogoutBar";
import { RoleNav } from "@/components/RoleNav";

const links = [
  { href: "/member", label: "Home" },
  { href: "/member/payments", label: "Payments" },
] as const;

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <RoleNav links={links} />
    </div>
  );
}
