"use client";

import { useParams, useRouter } from "next/navigation";
import { RoleDayView } from "@/features/attendance/ui/DayView";

export default function SecretaryDayPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  const router = useRouter();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    router.replace("/secretary");
    return null;
  }

  return <RoleDayView role="secretary" date={date} />;
}
