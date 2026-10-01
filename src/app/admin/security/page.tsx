import { SecurityPanel } from "@/components/admin/SecurityPanel";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Security · KofA AMS" };

export default function AdminSecurityPage() {
  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Security"
        description="Role PINs, device sign-outs, and login lockouts."
      />
      <SecurityPanel />
    </div>
  );
}
