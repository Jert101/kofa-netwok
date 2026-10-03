"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AttendanceAppealsReview } from "@/components/AttendanceAppealsReview";

type SessionGroup = {
  session_id: string;
  session_date: string;
  mass_name: string;
  appeals: {
    id: string;
    member_id: string;
    member_name: string;
    status: string;
    created_at: string;
    submitted_at: string | null;
  }[];
};

/**
 * APL-2: the central queue.
 *
 * One component for both roles, because `/secretary/appeals` and `/admin/appeals` differ
 * only in who is allowed to see them and what a session link looks like. Grouped by
 * session so the unit of decision is a Mass, which is also the unit the atomic
 * approval function works on.
 *
 * The month filter defaults to empty rather than the current month: a secretary who has
 * not opened the page in three weeks needs to see all three weeks, and the tab counts
 * tell them whether anything is old.
 */
export function AppealsQueuePage({
  role,
  dayPath,
}: {
  role: "admin" | "secretary";
  /**
   * Path prefix for this role's single-day view; the session date is appended.
   *
   * A string rather than a `dayHref(date)` callback, and that is not a style preference. This is a
   * client component, and both callers are server components, so a function arriving as a prop is not
   * serializable across the RSC boundary. React rejects it with "Functions cannot be passed directly
   * to Client Components" and the page renders as an error. A string crosses the boundary fine.
   */
  dayPath: string;
}) {
  const [groups, setGroups] = useState<SessionGroup[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const [month, setMonth] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setErr(null);
    const qs = new URLSearchParams({ status: tab });
    if (month) qs.set("month", month);
    const res = await fetch(`/api/attendance/appeals?${qs.toString()}`, {
      credentials: "same-origin",
    });
    if (!res.ok) {
      // Enveloped errors put the text at `error.message`, not `error`. See admin/masses.
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setErr(j.error?.message ?? "Could not load appeals.");
      setGroups([]);
      return;
    }
    const j = (await res.json()) as {
      data?: { sessions?: SessionGroup[]; pending_count?: number };
    };
    setGroups(j.data?.sessions ?? []);
    setPendingCount(j.data?.pending_count ?? 0);
  }, [tab, month]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <div>
      <h1 className="text-lg font-semibold">Attendance appeals</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {pendingCount === 0
          ? "No pending appeals."
          : `${pendingCount} pending appeal${pendingCount === 1 ? "" : "s"}.`}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="tablist" aria-label="Appeals by status">
          {(["pending", "resolved"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={tab === s}
              onClick={() => setTab(s)}
              className={
                "min-h-10 rounded-lg px-4 text-sm font-medium capitalize " +
                (tab === s
                  ? "bg-[var(--brand)] text-white"
                  : "border border-[var(--border)] text-[var(--text-muted)]")
              }
            >
              {s}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <span>Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
          />
          {month ? (
            <button
              type="button"
              onClick={() => setMonth("")}
              className="text-xs font-medium text-[var(--brand)] underline underline-offset-2"
            >
              Clear
            </button>
          ) : null}
        </label>
      </div>

      {err ? (
        <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
          {err}
        </p>
      ) : null}

      {groups === null ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          {tab === "pending" ? "Nothing waiting." : "No decided appeals for this filter."}
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map((g) => (
            <div key={g.session_id}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="text-sm font-semibold">
                  {g.mass_name} · {g.session_date}
                </h2>
                <span className="text-xs text-[var(--text-muted)]">
                  {g.appeals.length} {tab === "pending" ? "pending" : "decided"}
                </span>
                <Link
                  href={`${dayPath}/${g.session_date}`}
                  className="text-xs font-medium text-[var(--brand)] underline underline-offset-2"
                >
                  View {g.session_date}
                </Link>
              </div>
              <AttendanceAppealsReview
                sessionId={g.session_id}
                onAppealApproved={() => setReloadKey((k) => k + 1)}
              />
            </div>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-[var(--text-muted)]">
        Signed in as {role}. Approving an appeal writes the attendance and closes the
        appeal in one step; a decided appeal is kept as history.
      </p>
    </div>
  );
}
