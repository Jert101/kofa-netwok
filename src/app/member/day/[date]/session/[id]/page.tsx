"use client";

import { SessionScreen } from "@/features/attendance/ui/SessionScreen";
import {
  BadRouteParamNotice,
  useDayParam,
  useSessionIdParam,
} from "@/features/attendance/ui/route-params";

export default function MemberSessionDetailPage() {
  const date = useDayParam();
  const sessionId = useSessionIdParam();

  if (!date || !sessionId) {
    return <BadRouteParamNotice what="date or session" homeHref="/member" homeLabel="Back to the dashboard" />;
  }

  return <SessionScreen sessionId={sessionId} role="member" backHref={`/member/day/${date}`} />;
}