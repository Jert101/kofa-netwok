"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { MonthCalendar } from "@/components/MonthCalendar";

export default function SecretaryHomePage() {
  const [month, setMonth] = useState(() => new Date());
  const [appealDates, setAppealDates] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const monthKey = format(month, "yyyy-MM");
      const res = await fetch(`/api/attendance/appeals/month-indicators?month=${monthKey}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setAppealDates([]);
        return;
      }
      const j = (await res.json()) as { dates?: string[] };
      setAppealDates(j.dates ?? []);
    })();
  }, [month]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Encoding</h1>
      <AssignedServersSection memberBasePath="/secretary/day" />
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        onSelectDate={(ymd) => router.push(`/secretary/day/${ymd}`)}
        indicatorDates={appealDates}
        indicatorClassName="bg-[var(--danger)]"
      />
      <p className="text-xs text-[var(--muted)]">Red dot indicator: date has pending attendance appeal(s).</p>
    </div>
  );
}
