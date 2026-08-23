"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { MonthCalendar } from "@/components/MonthCalendar";

export default function AdminDashboardPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => new Date());
  const [dash, setDash] = useState<{
    today: string;
    sessions: { id: string; mass_name: string }[];
    attendance_count: number;
  } | null>(null);
  const [dashError, setDashError] = useState(false);

  const loadDash = async () => {
    setDashError(false);
    try {
      const res = await fetch("/api/admin/dashboard", { credentials: "same-origin" });
      if (!res.ok) {
        setDashError(true);
        return;
      }
      setDash(await res.json());
    } catch {
      setDashError(true);
    }
  };

  useEffect(() => {
    loadDash();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold sm:text-xl">Dashboard</h1>
      <AnnouncementsFeed />
      {dash ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <p className="text-sm text-[var(--muted)]">Today · {dash.today}</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl">{dash.attendance_count}</p>
          <p className="text-sm text-[var(--muted)]">total check-ins (all masses)</p>
          <ul className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {dash.sessions.length === 0 ? (
              <li className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
                No sessions today.
              </li>
            ) : (
              dash.sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/day/${dash.today}/session/${s.id}`}
                    className="block min-h-12 rounded-xl bg-[var(--surface-2)] px-4 py-3 font-medium"
                  >
                    {s.mass_name}
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : dashError ? (
        <div
          role="alert"
          className="rounded-2xl border border-dashed border-[var(--danger)] p-6 text-center"
        >
          <p className="text-sm font-medium text-[var(--danger)]">Could not load today&apos;s summary.</p>
          <button
            type="button"
            onClick={() => void loadDash()}
            className="mt-3 min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
          >
            Retry
          </button>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      )}

      <AssignedServersSection memberBasePath="/admin/day" />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Calendar</h2>
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          onSelectDate={(ymd) => router.push(`/admin/day/${ymd}`)}
        />
      </section>
    </div>
  );
}
