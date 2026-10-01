"use client";

import { useParams, useRouter } from "next/navigation";
import { RoleDayView } from "@/features/attendance/ui/DayView";

export default function AdminDayPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  const router = useRouter();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    router.replace("/admin");
    return null;
  }

  return <RoleDayView role="admin" date={date} />;
}
