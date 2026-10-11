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
  sundays_attended: number;
  sundays_held: number;
  lifetime_served: number;
  last_served_date: string | null;
  monthly: Array<{ month: string; label: string; attended: number; held: number }>;
  recent: Array<{ date: string; massName: string; attended: boolean }>;
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
                <dt className="text-[var(--text-muted)]">Sunday Mass attendance</dt>
                <dd className="text-lg font-semibold">{data.attendance_rate}%</dd>
                <dd className="text-xs text-[var(--text-muted)]">
                  {data.sundays_attended} of {data.sundays_held} Sunday Masses · last 12 weeks
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Weekend streak</dt>
                <dd className="text-lg font-semibold">
                  {data.weekend_streak} {data.weekend_streak === 1 ? "weekend" : "weekends"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Masses served, all time</dt>
                <dd className="text-lg font-semibold">{data.lifetime_served}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Last served</dt>
                <dd className="text-lg font-semibold">{data.last_served_date ?? "—"}</dd>
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

      {/* The month-by-month and Mass-by-Mass view of the same record above.
          Rendered only once the member has any attendance: an empty table with
          zeros would read as an accusation, and the section above already
          covers the new-member case. */}
      {data?.identity_declared && !data.empty_personal && data.attendance_rate !== null ? (
        <>
          {data.monthly.length > 0 ? (
            <section aria-labelledby="my-months" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 id="my-months" className="text-sm font-semibold text-[var(--brand)]">
                By month
              </h2>
              <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
                {data.monthly.map((m) => (
                  <li key={m.month} className="flex items-baseline justify-between gap-3 py-2">
                    <span>{m.label}</span>
                    <span className="text-[var(--text-muted)]">
                      {m.attended} of {m.held} Sunday Masses
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.recent.length > 0 ? (
            <section aria-labelledby="my-recent" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 id="my-recent" className="text-sm font-semibold text-[var(--brand)]">
                Recent Sunday Masses
              </h2>
              <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
                {data.recent.map((r) => (
                  <li key={`${r.date}-${r.massName}`} className="flex items-baseline justify-between gap-3 py-2">
                    <span>
                      {r.date} <span className="text-[var(--text-muted)]">· {r.massName}</span>
                    </span>
                    <span
                      className={
                        r.attended
                          ? "font-medium text-[var(--success-text)]"
                          : "text-[var(--text-muted)]"
                      }
                    >
                      {r.attended ? "Present" : "Missed"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}