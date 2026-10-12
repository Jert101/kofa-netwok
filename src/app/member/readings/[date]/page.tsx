"use client";

import { BadRouteParamNotice, useDayParam } from "@/features/attendance/ui/route-params";
import { ReadingsView } from "@/components/readings/ReadingsView";
import { describeDate } from "@/lib/readings/calendar";

/**
 * One civil date's liturgy, computed on the device from the date alone. No
 * fetch, no loading state, nothing to fail: the engine is pure, so a bad
 * URL is the only failure mode and it gets the shared notice.
 */
export default function MemberReadingsDatePage() {
  const date = useDayParam();

  if (!date) {
    return <BadRouteParamNotice what="date" homeHref="/member" homeLabel="Back to the dashboard" />;
  }

  return <ReadingsView date={date} info={describeDate(date)} />;
}
