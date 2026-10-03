import type { Metadata } from "next";
import { AppealsQueuePage } from "@/features/appeals/ui/AppealsQueuePage";

export const metadata: Metadata = { title: "Attendance appeals" };

export default function AdminAppealsPage() {
  return <AppealsQueuePage role="admin" dayPath="/admin/day" />;
}
