"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { MonthCalendar } from "@/components/MonthCalendar";

type Announcement = {
  id: string;
  title: string;
  body: string;
  created_by: "admin" | "secretary";
  created_at: string;
};

export default function MemberHomePage() {
  const [month, setMonth] = useState(() => new Date());
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [sessionDates, setSessionDates] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/announcements", { credentials: "same-origin" });
      if (!res.ok) {
        setAnnouncements([]);
        return;
      }
      const j = (await res.json()) as { announcements?: Announcement[] };
      setAnnouncements(j.announcements ?? []);
    })();
  }, []);

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
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--accent)]">Announcements</h2>
        {announcements === null ? (
          <p className="mt-2 text-sm text-[var(--muted)]">Loading announcements...</p>
        ) : announcements.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No announcements yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {announcements.map((a) => (
              <li key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
                    <span className="font-medium text-[var(--text)]">{a.title}</span>
                    <span className="text-xs text-[var(--muted)] group-open:rotate-180">▼</span>
                  </summary>
                  <div className="border-t border-[var(--border)] px-3 pb-3 pt-2">
                    <p className="whitespace-pre-wrap text-sm text-[var(--muted)]">{a.body}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      By {a.created_by} · {new Date(a.created_at).toLocaleString()}
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
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
