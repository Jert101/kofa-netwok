"use client";

import { useCallback, useEffect, useState } from "react";
import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { AttendanceCalendar } from "@/features/attendance/ui/AttendanceCalendar";
import { UpcomingAssignmentsCard } from "@/features/liturgy/ui/UpcomingAssignmentsCard";

type MemberDashboard = {
  as_of: string;
  identity_declared: boolean;
  full_name: string | null;
  attendance_rate: number | null;
  weekend_streak: number | null;
  birthdays: Array<{ memberId: string; fullName: string; date: string; isToday: boolean }>;
  empty_personal: boolean;
};

/**
 * DSH-4's home.
 *
 * Ordered as the spec lays it out: announcements, upcoming assignments, birthdays, then the declared
 * person's own attendance. The appeal card deliberately stays on the session pages rather than here --
 * an appeal is about one Mass, and the member needs the session in front of them to judge it.
 */
export default function MemberHomePage() {
  const [data, setData] = useState<MemberDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/dashboard/member", { credentials: "same-origin", cache: "no-store" });
      // The attendance and identity banner never appeared when this failed, and the page said
      // nothing about it -- so "no attendance" and "could not read attendance" looked the same.
      // The rest of the page is independent, so the failure is confined to the attendance block.
      if (!res.ok) {
        setLoadError("Could not load your attendance.");
        return;
      }
      const json = (await res.json()) as { data?: MemberDashboard };
      setData(json.data ?? null);
    } catch {
      setLoadError("Could not load your attendance.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = data?.birthdays ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Attendance</h1>
      <AnnouncementsFeed />

      {/* LIT-5: the card the member actually asked for. */}
      <UpcomingAssignmentsCard />

      {mine.length > 0 ? (
        <section aria-labelledby="my-birthday" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 id="my-birthday" className="text-sm font-semibold text-[var(--brand)]">
            Your birthday
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {mine.map((b) => (
              <li key={`${b.memberId}-${b.date}`} className="flex items-baseline justify-between gap-3">
                <span>{b.fullName}</span>
                <span className="text-[var(--text-muted)]">{b.isToday ? "Today" : b.date.slice(5)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loadError ? (
        <p role="alert" className="rounded-2xl border border-[var(--danger)] p-4 text-sm text-[var(--danger)]">
          {loadError}
        </p>
      ) : loading && !data ? (
        <p className="text-sm text-[var(--text-muted)]">Loading your attendance…</p>
      ) : null}

      {data?.identity_declared ? (
        <section aria-labelledby="my-attendance" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 id="my-attendance" className="text-sm font-semibold text-[var(--brand)]">
            Your attendance
          </h2>
          {data.empty_personal || data.attendance_rate === null ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              No Sunday attendance recorded yet. Being new is not the same as being absent.
            </p>
          ) : (
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--text-muted)]">Sundays attended</dt>
                <dd className="text-lg font-semibold">{data.attendance_rate}%</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Weekend streak</dt>
                <dd className="text-lg font-semibold">
                  {data.weekend_streak} {data.weekend_streak === 1 ? "weekend" : "weekends"}
                </dd>
              </div>
            </dl>
          )}
        </section>
      ) : data && !data.identity_declared ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
          You are signed in without a declared parish identity, so there is no attendance history to
          show for you. Ask an admin to link your account to a record on the member roll, and your own
          rates and reminders will appear here.
        </p>
      ) : null}

      <AssignedServersSection memberBasePath="/member/day" />
      <AttendanceCalendar role="member" />
    </div>
  );
}