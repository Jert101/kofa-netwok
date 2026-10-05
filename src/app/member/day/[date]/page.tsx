"use client";

import { RoleDayView } from "@/features/attendance/ui/DayView";
import { BadRouteParamNotice, useDayParam } from "@/features/attendance/ui/route-params";

export default function MemberDayPage() {
  const date = useDayParam();

  if (!date) {
    return <BadRouteParamNotice what="date" homeHref="/member" homeLabel="Back to the dashboard" />;
  }

  return <RoleDayView role="member" date={date} />;
}