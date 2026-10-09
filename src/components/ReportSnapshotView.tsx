"use client";

import type { GridCellMark, ReportGridColumn, ReportGridRow } from "@/lib/reports/weekend-grid";
import { columnHeading, normaliseTotals } from "@/lib/reports/snapshot";

/**
 * Read-only view of a stored report snapshot (RPT-4, "decide without opening the PDF").
 *
 * Shared by the secretary/admin hub and the super admin console so the reviewer sees the same
 * grid the PDF would show. Marks come from the stored `summary_json`, never recomputed, so what
 * a super admin approves is literally what the generator wrote.
 */

export type SnapshotPayload = {
  grid: {
    columns: ReportGridColumn[];
    rows: ReportGridRow[];
  } | null;
  totals: Record<string, number> | null;
  monthLabel: string | null;
  version: number;
};

const CELL_LABEL: Record<GridCellMark, string> = { S: "Served", A: "Absent" };

function SummaryTiles({ totals }: { totals: Record<string, number> | null }) {
  // Accepts either the stored snake_case shape or the preview endpoint's camelCase, so the
  // same tiles work for a saved report and a live preview.
  const t = normaliseTotals(totals);
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Masses in report</dt>
        <dd className="text-lg font-semibold text-[var(--text)]">{t.sessionsInReport ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Attendance</dt>
        <dd className="text-lg font-semibold text-[var(--text)]">{t.attendance ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Members</dt>
        <dd className="text-lg font-semibold text-[var(--text)]">{t.memberCount ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">No attendance</dt>
        <dd className="text-lg font-semibold text-[var(--text)]">{t.zeroAttendanceMembers ?? "—"}</dd>
      </div>
    </dl>
  );
}

export function ReportSnapshotView({
  snapshot,
  pdfHref,
}: {
  snapshot: SnapshotPayload;
  pdfHref?: string;
}) {
  if (!snapshot.grid) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-6 text-center">
        <p className="text-sm font-medium text-[var(--text)]">On-screen grid unavailable</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">
          Reports generated before September don&apos;t store their grid, so the attendance table and
          exports are not available for this month. The PDF still works.
        </p>
        {pdfHref ? (
          <a
            href={pdfHref}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white"
          >
            Open PDF
          </a>
        ) : null}
      </div>
    );
  }

  const { columns, rows } = snapshot.grid;

  return (
    <div className="space-y-4">
      <SummaryTiles totals={snapshot.totals} />

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Attendance grid for {snapshot.monthLabel ?? "this report"}
          </caption>
          <thead>
            <tr className="bg-[var(--surface-2)]">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-[var(--surface-2)] px-3 py-2 text-left font-medium text-[var(--text)]"
              >
                Member
              </th>
              {columns.map((c, i) => (
                <th
                  key={c.sessionId}
                  scope="col"
                  className="px-2 py-2 text-center text-xs font-medium text-[var(--text)]"
                >
                  <span className="block">{columnHeading(c.date)}</span>
                  <span className="block font-normal text-[var(--text-muted)]">{c.massName}</span>
                  {i === 0 ? <span className="sr-only">first column</span> : null}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-center font-medium text-[var(--text)]">
                Served
              </th>
              <th scope="col" className="px-2 py-2 text-left font-medium text-[var(--text)]">
                Remarks
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className="border-t border-[var(--border)]">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-[var(--surface)] px-3 py-1.5 text-left font-normal text-[var(--text)]"
                >
                  {r.name}
                </th>
                {r.cells.map((mark, i) => (
                  <td key={`${r.memberId}-${i}`} className="px-2 py-1.5 text-center">
                    <span
                      title={`${CELL_LABEL[mark]} · ${columns[i]?.massName ?? ""}`}
                      className={
                        mark === "S"
                          ? "font-semibold text-[var(--success-text)]"
                          : "text-[var(--text-muted)]"
                      }
                    >
                      {mark}
                    </span>
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center font-semibold text-[var(--text)]">
                  {r.served}
                </td>
                <td className="px-2 py-1.5 text-xs text-[var(--text-muted)]">{r.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No active members to list for this month.</p>
      ) : null}

      <p className="text-xs text-[var(--text-muted)]">
        S served, A absent. The grid is the report&apos;s stored snapshot, not live attendance.
      </p>
    </div>
  );
}

/**
 * Fetch a snapshot by report id.
 *
 * `grid` sits at the top level of the response, sibling to `summary` — not inside it. The two
 * were briefly read as `summary.grid`, which silently rendered every v5 report as
 * "grid unavailable" because `undefined` is falsy and the fallback path looked correct.
 */
export async function fetchSnapshot(id: string): Promise<{ ok: true; data: SnapshotPayload } | { ok: false; error: string }> {
  const res = await fetch(`/api/reports/${id}`, { credentials: "same-origin" });
  const j = (await res.json()) as {
    summary?: { totals?: Record<string, number> | null; monthLabel?: string | null; version?: number };
    grid?: SnapshotPayload["grid"];
    error?: string;
  };
  if (!res.ok) return { ok: false, error: j.error ?? "Could not load this report." };
  return {
    ok: true,
    data: {
      grid: j.grid ?? null,
      totals: j.summary?.totals ?? null,
      monthLabel: j.summary?.monthLabel ?? null,
      version: j.summary?.version ?? 4,
    },
  };
}