"use client";

import { RoleDayView } from "@/features/attendance/ui/DayView";
import { BadRouteParamNotice, useDayParam } from "@/features/attendance/ui/route-params";

export default function SecretaryDayPage() {
  const date = useDayParam();

  if (!date) {
    return <BadRouteParamNotice what="date" homeHref="/secretary" homeLabel="Back to the dashboard" />;
  }

  return <RoleDayView role="secretary" date={date} />;
}