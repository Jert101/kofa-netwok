"use client";

import { useParams } from "next/navigation";
import { SessionScreen } from "@/features/attendance/ui/SessionScreen";

export default function MemberSessionDetailPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  return (
    <SessionScreen
      sessionId={String(params.id ?? "")}
      role="member"
      backHref={date ? `/member/day/${date}` : "/member"}
    />
  );
}
