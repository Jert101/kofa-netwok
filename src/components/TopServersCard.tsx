"use client";

import { useEffect, useState } from "react";

type TopServer = {
  member_id: string;
  full_name: string;
  total_served: number;
};

export function TopServersCard() {
  const [servers, setServers] = useState<TopServer[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/top-servers", { credentials: "same-origin" });
        if (!res.ok) {
          setServers([]);
          return;
        }
        const j = (await res.json()) as { top_servers?: TopServer[] };
        setServers(j.top_servers ?? []);
      } catch {
        setServers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight text-[var(--text)]">
          Top 20 Members — Most Masses Served
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          Members with the highest attendance count across all recorded sessions.
        </p>
      </div>

      <div className="p-4">
        {loading ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">Loading…</p>
        ) : !servers || servers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
            No attendance records yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-2">#</th>
                  <th className="pb-2 pr-2">Name</th>
                  <th className="pb-2 text-right">Masses served</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s, idx) => (
                  <tr key={s.member_id} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2.5 pr-2 text-[var(--muted)]">{idx + 1}</td>
                    <td className="py-2.5 pr-2 font-medium text-[var(--text)]">{s.full_name}</td>
                    <td className="py-2.5 text-right font-semibold text-[var(--accent)]">
                      {s.total_served}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <a
            href="/api/admin/top-servers/pdf"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white shadow-sm active:scale-[0.99]"
          >
            Download PDF
          </a>
        </div>
      </div>
    </section>
  );
}
