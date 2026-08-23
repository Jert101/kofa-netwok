import { LogoutBar } from "@/components/LogoutBar";
import { RoleNav } from "@/components/RoleNav";

const links = [
  { href: "/secretary", label: "Calendar" },
  { href: "/secretary/inbox", label: "Inbox" },
  { href: "/secretary/payments", label: "Payments" },
  { href: "/secretary/reports", label: "Reports" },
] as const;

export default function SecretaryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <RoleNav links={links} />
    </div>
  );
}
