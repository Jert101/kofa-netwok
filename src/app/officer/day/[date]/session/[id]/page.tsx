"use client";

import { SessionScreen } from "@/features/attendance/ui/SessionScreen";
import {
  BadRouteParamNotice,
  useDayParam,
  useSessionIdParam,
} from "@/features/attendance/ui/route-params";

export default function OfficerSessionPage() {
  const date = useDayParam();
  const sessionId = useSessionIdParam();

  if (!date || !sessionId) {
    return <BadRouteParamNotice what="date or session" homeHref="/officer" homeLabel="Back to the dashboard" />;
  }

  return <SessionScreen sessionId={sessionId} role="officer" backHref={`/officer/day/${date}`} />;
}