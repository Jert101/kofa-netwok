"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { MonthCalendar, type MonthIndicator } from "@/features/attendance/ui/MonthCalendar";

type Payload = {
  month: string;
  today: string;
  locked: boolean;
  locked_message: string | null;
  indicators: MonthIndicator[];
};

export type CalendarRole = "member" | "secretary" | "admin" | "officer";

/**
 * Month calendar with its data.
 *
 * Owns the month itself. The caller passes an optional initial month so a deep link or
 * a test can pin it, but navigation stays in this component: re-rendering a different
 * month is one fetch, where a link would throw away the announcements, the assigned
 * servers and the scroll position above the calendar.
 */
export function AttendanceCalendar({
  role,
  initialMonth,
}: {
  role: CalendarRole;
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(initialMonth ?? format(new Date(), "yyyy-MM"));
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/month-indicators?month=${month}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setData((await res.json()) as Payload);
    } catch {
      setFailed(true);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      {failed ? (
        <p role="alert" className="mb-2 text-sm text-[var(--danger)]">
          Could not load the calendar.
        </p>
      ) : null}
      <MonthCalendar
        month={month}
        today={data?.today ?? ""}
        locked={data?.locked ?? false}
        indicators={data?.indicators ?? []}
        showAppeals={role === "secretary" || role === "admin"}
        buildDayHref={(date) => `/${role}/day/${date}`}
        onMonthChange={setMonth}
      />
      {data?.locked_message ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{data.locked_message}</p>
      ) : null}
      <p className="mt-2 text-xs text-[var(--muted)]">
        <span className="font-medium">Green dot</span> attendance recorded ·{" "}
        <span className="font-medium">amber dot</span> needs encoding
        {role === "secretary" || role === "admin" ? (
          <>
            {" "}
            · <span className="font-medium">red dot</span> appeal waiting
          </>
        ) : null}
      </p>
    </>
  );
}
