"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { MonthCalendar } from "@/components/MonthCalendar";

export default function MemberHomePage() {
  const [month, setMonth] = useState(() => new Date());
  const [sessionDates, setSessionDates] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const monthKey = format(month, "yyyy-MM");
      const res = await fetch(`/api/attendance/month-indicators?month=${monthKey}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setSessionDates([]);
        return;
      }
      const j = (await res.json()) as { dates?: string[] };
      setSessionDates(j.dates ?? []);
    })();
  }, [month]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Attendance</h1>
      <AnnouncementsFeed />
      <AssignedServersSection memberBasePath="/member/day" />
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        onSelectDate={(ymd) => router.push(`/member/day/${ymd}`)}
        indicatorDates={sessionDates}
        indicatorClassName="bg-[var(--accent)]"
      />
      <p className="text-xs text-[var(--muted)]">Dot indicator: date has at least one mass/session.</p>
    </div>
  );
}
