"use client";

import { useEffect, useState } from "react";

type InactiveMember = {
  member_id: string;
  full_name: string;
};

export function InactiveMembersCard() {
  const [data, setData] = useState<{ period: { start: string; end: string }; count: number; members: InactiveMember[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/inactive-members", { credentials: "same-origin" });
        if (!res.ok) {
          setData(null);
          return;
        }
        const j = await res.json();
        setData(j);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const list = data?.members ?? [];

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight text-[var(--text)]">
          Inactive Members — No Service in 2 Months
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          Active members with zero attendance records in the last 2 complete calendar months.
        </p>
      </div>

      <div className="p-4">
        {loading ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">Loading…</p>
        ) : !data ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
            Could not load data.
          </p>
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
            All active members have served at least once in the last 2 months.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-[var(--muted)]">
              Period: <span className="font-medium text-[var(--text)]">{data.period.start}</span> –{" "}
              <span className="font-medium text-[var(--text)]">{data.period.end}</span>
              &nbsp;·&nbsp;
              <span className="font-semibold text-[var(--accent)]">{data.count}</span> member{data.count !== 1 ? "s" : ""}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2 pr-2">#</th>
                    <th className="pb-2">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {(expanded ? list : list.slice(0, 10)).map((m, idx) => (
                    <tr key={m.member_id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2.5 pr-2 text-[var(--muted)]">{idx + 1}</td>
                      <td className="py-2.5 font-medium text-[var(--text)]">{m.full_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {list.length > 10 && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="mt-3 text-sm font-medium text-[var(--accent)] hover:underline"
              >
                {expanded ? "Show less" : `Show all ${list.length} members`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
