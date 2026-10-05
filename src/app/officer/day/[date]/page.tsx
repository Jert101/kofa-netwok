"use client";

import { RoleDayView } from "@/features/attendance/ui/DayView";
import { BadRouteParamNotice, useDayParam } from "@/features/attendance/ui/route-params";

export default function OfficerDayPage() {
  const date = useDayParam();

  if (!date) {
    return <BadRouteParamNotice what="date" homeHref="/officer" homeLabel="Back to the dashboard" />;
  }

  return <RoleDayView role="officer" date={date} />;
}