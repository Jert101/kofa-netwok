"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Unrecorded = {
  session_id: string;
  date: string;
  mass_name: string;
  days_ago: number;
  sunday: boolean;
};

type SecretaryDashboard = {
  as_of: string;
  unrecorded_sessions: Unrecorded[];
  pending_appeals: number;
  appeal_window_days: number;
  report_readiness: { state: string; text: string; report_id?: string; opens_on?: string };
  empty: boolean;
};

/**
 * DSH-2: the secretary's "Needs attention" card.
 *
 * A worklist, not a scoreboard. Each item is an obligation with a link that clears it, so opening the
 * app on a Monday morning answers "what is Monday morning for".
 */
export function SecretaryNeedsAttention() {
  const [data, setData] = useState<SecretaryDashboard | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/dashboard/secretary", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const json = (await res.json()) as { data?: SecretaryDashboard };
      setData(json.data ?? null);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <section className="rounded-2xl border border-dashed border-[var(--danger)] p-4">
        <p className="text-sm text-[var(--danger)]">Could not load what needs attention.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!data) return null;

  if (data.empty) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--success-soft)] p-4">
        <h2 className="text-sm font-semibold">Nothing needs attention</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Every session has attendance and no appeals are waiting.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="needs-attention-heading" className="rounded-2xl border border-[var(--brand)] bg-[var(--surface)] p-4">
      <h2 id="needs-attention-heading" className="text-sm font-semibold text-[var(--brand)]">
        Needs attention
      </h2>

      {data.unrecorded_sessions.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-sm font-medium">Sessions with no attendance recorded</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {data.unrecorded_sessions.slice(0, 6).map((s) => (
              <li key={s.session_id} className="flex items-baseline justify-between gap-3">
                <Link href={`/secretary/day/${s.date}/session/${s.session_id}`} className="underline">
                  {s.mass_name}
                  {s.sunday ? "" : " (weekday)"}
                </Link>
                <span className="shrink-0 text-[var(--text-muted)]">
                  {s.date} · {s.days_ago === 0 ? "today" : `${s.days_ago}d ago`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.pending_appeals > 0 ? (
        <div className="mt-3">
          <h3 className="text-sm font-medium">Appeals waiting</h3>
          <Link href="/secretary/appeals" className="text-sm underline">
            {data.pending_appeals} {data.pending_appeals === 1 ? "appeal" : "appeals"} to answer
          </Link>
        </div>
      ) : null}

      <div className="mt-3">
        <h3 className="text-sm font-medium">This month&apos;s report</h3>
        {data.report_readiness.state === "generated" ? (
          <p className="text-sm text-[var(--text-muted)]">{data.report_readiness.text}</p>
        ) : data.report_readiness.state === "ready" ? (
          <Link href="/secretary/reports" className="text-sm underline">
            Ready to generate.
          </Link>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{data.report_readiness.text}</p>
        )}
      </div>
    </section>
  );
}

/**
 * DSH-3: the officer's "Needs attention" card.
 *
 * Kept separate from the secretary's rather than made generic: the two lists are built from different
 * tables and mean different things, and a shared component with two flag props would be harder to read
 * than two small ones.
 */
export function OfficerNeedsAttention() {
  const [data, setData] = useState<{
    as_of: string;
    until: string;
    needs_attention: Array<{ date: string; mass_names: string[]; positions: number; unassigned: number; href: string }>;
    unplanned: Array<{ date: string; mass_names: string[]; positions: number; unassigned: number; href: string }>;
    empty: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/officer", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: NonNullable<typeof data> };
      setData(json.data ?? null);
    } catch {
      // The planner card below still works; this one is a convenience.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data || data.empty) return null;

  return (
    <section aria-labelledby="officer-attention" className="rounded-2xl border border-[var(--brand)] bg-[var(--surface)] p-4">
      <h2 id="officer-attention" className="text-sm font-semibold text-[var(--brand)]">
        Needs attention in the next 14 days
      </h2>

      {data.needs_attention.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {data.needs_attention.slice(0, 6).map((d) => (
            <li key={d.date} className="flex items-baseline justify-between gap-3">
              <Link href={d.href} className="underline">
                {d.mass_names.join(", ")}
              </Link>
              <span className="shrink-0 text-[var(--text-muted)]">
                {d.date} · {d.unassigned} of {d.positions} unfilled
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {data.unplanned.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-sm font-medium">No plan yet</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {data.unplanned.slice(0, 4).map((d) => (
              <li key={d.date}>
                <Link href={d.href} className="underline">
                  {d.mass_names.join(", ")}
                </Link>{" "}
                <span className="text-[var(--text-muted)]">{d.date}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}