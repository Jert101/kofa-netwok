"use client";

import { SessionScreen } from "@/features/attendance/ui/SessionScreen";
import {
  BadRouteParamNotice,
  useDayParam,
  useSessionIdParam,
} from "@/features/attendance/ui/route-params";

export default function AdminSessionRosterPage() {
  const date = useDayParam();
  const sessionId = useSessionIdParam();

  // Both segments are checked before either is used: `sessionId` went straight into the fetch URL, and
  // `date` was pasted into the back link, so a mangled address produced a bad request and a "back"
  // button pointing at another bad address.
  if (!date || !sessionId) {
    return <BadRouteParamNotice what="date or session" homeHref="/admin" homeLabel="Back to the dashboard" />;
  }

  return <SessionScreen sessionId={sessionId} role="admin" backHref={`/admin/day/${date}`} />;
}