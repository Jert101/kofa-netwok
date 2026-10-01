"use client";

import { useParams } from "next/navigation";
import { SessionScreen } from "@/features/attendance/ui/SessionScreen";

export default function OfficerSessionPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  return (
    <SessionScreen
      sessionId={String(params.id ?? "")}
      role="officer"
      backHref={date ? `/officer/day/${date}` : "/officer"}
    />
  );
}
