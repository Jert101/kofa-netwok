"use client";

import { useParams } from "next/navigation";
import { SessionScreen } from "@/features/attendance/ui/SessionScreen";

export default function AdminSessionRosterPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  return (
    <SessionScreen
      sessionId={String(params.id ?? "")}
      role="admin"
      backHref={date ? `/admin/day/${date}` : "/admin"}
    />
  );
}
