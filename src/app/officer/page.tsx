"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { MonthCalendar } from "@/components/MonthCalendar";

export default function OfficerHomePage() {
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
      <h1 className="text-lg font-semibold sm:text-xl">Officer</h1>
      <p className="text-sm text-[var(--muted)]">
        Choose a date, pick a mass, then assign roles (Crucifix, candles, etc.). Saving notifies subscribers with push
        enabled. Post general notices below or in <strong>Announcements</strong> in the menu.
      </p>
      <AnnouncementsFeed />
      <AssignedServersSection memberBasePath="/officer/day" />
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        onSelectDate={(ymd) => router.push(`/officer/day/${ymd}`)}
        indicatorDates={sessionDates}
        indicatorClassName="bg-[var(--accent)]"
      />
      <p className="text-xs text-[var(--muted)]">Dot: day has at least one scheduled mass/session.</p>
    </div>
  );
}
