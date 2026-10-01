"use client";

import { useParams } from "next/navigation";
import { SessionScreen } from "@/features/attendance/ui/SessionScreen";

export default function SecretarySessionPage() {
  const params = useParams();
  return (
    <SessionScreen
      sessionId={String(params.id ?? "")}
      role="secretary"
      backHref="/secretary"
    />
  );
}
