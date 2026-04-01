import { ReportsPanel } from "@/components/ReportsPanel";
import Image from "next/image";

export default function AdminReportsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="KofA logo" width={40} height={40} className="rounded-full" />
        <h1 className="text-lg font-semibold">Reports</h1>
      </div>
      <ReportsPanel showAdminScheduleBypass showArchiveToggle />
    </div>
  );
}
