import { AuditLog } from "@/components/admin/AuditLog";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Audit · KofA AMS" };

export default function AdminAuditPage() {
  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Audit"
        description="Who changed what, and when. Entries cannot be edited or deleted here."
      />
      <AuditLog />
    </div>
  );
}
