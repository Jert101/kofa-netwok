import { LogoutBar } from "@/components/LogoutBar";
import { RoleNav } from "@/components/RoleNav";

const links = [
  { href: "/admin", label: "Home" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/registrations", label: "Registrations" },
  { href: "/admin/payments", label: "Payments" },
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
      <RoleNav links={links} />
    </div>
  );
}
