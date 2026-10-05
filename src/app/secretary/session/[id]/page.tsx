"use client";

import { SessionScreen } from "@/features/attendance/ui/SessionScreen";
import {
  BadRouteParamNotice,
  useSessionIdParam,
} from "@/features/attendance/ui/route-params";

export default function SecretarySessionPage() {
  const sessionId = useSessionIdParam();

  // No `[date]` segment on this one, but the id is still checked before it becomes a fetch URL.
  if (!sessionId) {
    return <BadRouteParamNotice what="session" homeHref="/secretary" homeLabel="Back to the dashboard" />;
  }

  return <SessionScreen sessionId={sessionId} role="secretary" backHref="/secretary" />;
}