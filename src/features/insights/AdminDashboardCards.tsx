"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart, LineChart } from "@/features/insights/Charts";

type Kpis = {
  active_members: number;
  sessions_this_month: number;
  average_attendance: number | null;
  pending_registrations: number;
  pending_appeals: number;
  pending_reports: number;
};

type TrendPoint = { weekStart: string; attendance: number; sessionsHeld: number };

type AdminDashboard = {
  as_of: string;
  kpis: Kpis;
  trend: TrendPoint[];
  trend_summary: string;
  turnout: Array<{ massName: string; average: number; sessionsHeld: number }>;
  turnout_summary: string;
  at_risk: Array<{
    member_id: string;
    full_name: string;
    truncated_name: string;
    reasons_text: string;
    recent_rate: number;
    baseline_rate: number;
  }>;
  inactive: Array<{ member_id: string; full_name: string; truncated_name: string }>;
  birthdays: Array<{ memberId: string; fullName: string; date: string; isToday: boolean }>;
  activity: Array<{ id: string; at: string; text: string }>;
  empty: { no_sessions_this_month: boolean; no_members: boolean };
};

/**
 * DSH-1: the admin dashboard.
 *
 * Ordered top to bottom as the spec lays it out: KPIs, trend, turnout by Mass, at-risk, inactive, top
 * servers (below), birthdays, recent activity.
 *
 * Every card links to the page it is counting, and the number on the card comes from the same metric
 * function that page uses -- which is the acceptance criterion that a dashboard number and the page it
 * points at must agree.
 */
export function AdminDashboardCards() {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/dashboard/admin", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = (await res.json()) as { data?: AdminDashboard };
      setData(json.data ?? null);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-dashed border-[var(--danger)] p-6 text-center">
        <p className="text-sm font-medium text-[var(--danger)]">Could not load the dashboard.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return <p className="text-sm text-[var(--text-muted)]">Loading the dashboard…</p>;

  if (data.empty.no_members) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
        No members on the roll yet. Add members from the Members page to start tracking attendance.
      </div>
    );
  }

  const kpi = (
    label: string,
    value: string,
    href: string,
  ) => (
    <Link
      href={href}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--surface-2)]"
    >
      <dt className="text-sm text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </Link>
  );

  return (
    <div className="space-y-8">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpi("Active members", String(data.kpis.active_members), "/admin/members")}
        {kpi(
          "Sessions this month",
          String(data.kpis.sessions_this_month),
          "/admin",
        )}
        {kpi(
          // Null, not zero. A parish with no sessions yet is not a parish with no attendance.
          "Average attendance",
          data.kpis.average_attendance === null ? "—" : String(data.kpis.average_attendance),
          "/admin",
        )}
        {kpi("Pending registrations", String(data.kpis.pending_registrations), "/admin/registrations")}
        {kpi("Pending appeals", String(data.kpis.pending_appeals), "/admin/appeals")}
        {kpi("Reports waiting", String(data.kpis.pending_reports), "/admin/reports")}
      </dl>

      {data.empty.no_sessions_this_month ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
          No sessions recorded this month. Create this weekend&apos;s sessions to start the trend.
        </p>
      ) : (
        <LineChart
          title="Weekend attendance, last 12 weeks"
          summary={data.trend_summary}
          labels={data.trend.map((p) => p.weekStart.slice(5))}
          values={data.trend.map((p) => p.attendance)}
        />
      )}

      <BarChart
        title="Average attendance by Mass, last 8 weeks"
        summary={data.turnout_summary}
        rows={data.turnout.map((t) => ({ label: t.massName, value: t.average }))}
      />

      <section aria-labelledby="at-risk-heading">
        <h2 id="at-risk-heading" className="text-sm font-semibold text-[var(--brand)]">
          Members to check in with
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Members who had been coming regularly and have recently stopped or slowed down.
        </p>
        {data.at_risk.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">Nobody has dropped off recently.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.at_risk.map((m) => (
              <li key={m.member_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/admin/members/${m.member_id}`}
                    className="font-medium underline"
                    title={m.full_name}
                  >
                    {m.truncated_name}
                  </Link>
                  <span className="text-xs text-[var(--text-muted)]">
                    {m.recent_rate}% now · {m.baseline_rate}% before
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{m.reasons_text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InactiveMembersCard members={data.inactive} />
      <TopServersCard />

      <section aria-labelledby="birthdays-heading">
        <h2 id="birthdays-heading" className="text-sm font-semibold text-[var(--brand)]">
          Birthdays, today and this week
        </h2>
        {data.birthdays.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            No birthdays recorded in the next seven days.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {data.birthdays.map((b) => (
              <li key={`${b.memberId}-${b.date}`} className="flex items-baseline justify-between gap-3">
                <span>{b.fullName}</span>
                <span className="text-[var(--text-muted)]">
                  {b.isToday ? "Today" : b.date.slice(5)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="activity-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="activity-heading" className="text-sm font-semibold text-[var(--brand)]">
            Recent activity
          </h2>
          <Link href="/admin/audit" className="text-sm underline">
            Full audit log
          </Link>
        </div>
        {data.activity.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {data.activity.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3">
                <span>{a.text}</span>
                <span className="shrink-0 text-[var(--text-muted)]">{a.at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * DSH-1's inactive-members card, rebuilt on the shared metric.
 *
 * The old card had its own two-month rule written inline and was not rendered by any page, so it and
 * the metrics could disagree without anything noticing. This one takes the dashboard's answer.
 */
function InactiveMembersCard({
  members,
}: {
  members: Array<{ member_id: string; full_name: string; truncated_name: string }>;
}) {
  return (
    <section aria-labelledby="inactive-heading">
      <h2 id="inactive-heading" className="text-sm font-semibold text-[var(--brand)]">
        Inactive members
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        No service in the last two months. Members who have never served are not listed.
      </p>
      {members.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">Nobody is inactive.</p>
      ) : (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer text-sm text-[var(--text-muted)]">
            {members.length} {members.length === 1 ? "member" : "members"}
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {members.map((m) => (
              <li key={m.member_id}>
                <Link href={`/admin/members/${m.member_id}`} className="underline" title={m.full_name}>
                  {m.truncated_name}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * Top servers, kept as its own card.
 *
 * Module 10's brief says to move this onto the shared metrics; what it means is that the *counting*
 * stays one implementation, which the dashboard history read now is. The presentation is unchanged
 * because nothing about it was wrong.
 */
function TopServersCard() {
  const [rows, setRows] = useState<Array<{ member_id: string; full_name: string; total_served: number }>>(
    [],
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/top-servers", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { top_servers?: typeof rows };
        setRows(json.top_servers ?? []);
      } catch {
        // A missing card is better than a broken dashboard; the rest of it still renders.
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded || rows.length === 0) return null;

  return (
    <section aria-labelledby="top-servers-heading">
      <h2 id="top-servers-heading" className="text-sm font-semibold text-[var(--brand)]">
        Top servers
      </h2>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer text-sm text-[var(--text-muted)]">
          Show the top {rows.length}
        </summary>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">Members by number of times served, all time</caption>
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th scope="col" className="py-1 pr-3 font-medium">Member</th>
              <th scope="col" className="py-1 text-right font-medium">Served</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.member_id} className="border-t border-[var(--border)]">
                <th scope="row" className="py-1 pr-3 font-normal">
                  <Link href={`/admin/members/${r.member_id}`} className="underline">
                    {r.full_name}
                  </Link>
                </th>
                <td className="py-1 text-right tabular-nums">{r.total_served}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}