"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LedgerView } from "@/features/payments/LedgerView";
import { formatPeso } from "@/lib/format-peso";
import { churchTodayLabel, truncateName } from "@/lib/time/church-time-labels";

type OverdueRow = {
  memberId: string;
  memberName: string;
  batch: string | null;
  structureId: string;
  structureName: string;
  amount: number;
  paid: number;
  due: number;
  remaining: number;
  monthsOverdue: number;
};

/**
 * PAY-5: who has not paid, worst first.
 *
 * Sorted by the server, from the same array the CSV is built out of, so "CSV exports match the screen"
 * is true by construction rather than by discipline. The filter row is a plain form rather than a
 * client-side filter because the filter is applied in SQL and the page must not claim to have narrowed
 * something it did not.
 */
export default function TreasurerOverduePage() {
  const [rows, setRows] = useState<OverdueRow[]>([]);
  const [summary, setSummary] = useState<{
    as_of: string;
    count: number;
    row_count: number;
    total_outstanding: number;
  } | null>(null);
  const [structures, setStructures] = useState<Array<{ id: string; name: string }>>([]);
  const [batches, setBatches] = useState<string[]>([]);
  const [structureId, setStructureId] = useState("");
  const [batch, setBatch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledgerMemberId, setLedgerMemberId] = useState<string | null>(null);

  const csvHref = useMemo(() => {
    const params = new URLSearchParams({ format: "csv" });
    if (structureId) params.set("structure_id", structureId);
    if (batch) params.set("batch", batch);
    return `/api/treasurer/overdue?${params.toString()}`;
  }, [structureId, batch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (structureId) params.set("structure_id", structureId);
      if (batch) params.set("batch", batch);

      const res = await fetch(`/api/treasurer/overdue?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Could not load the overdue list.");
        return;
      }
      const json = (await res.json()) as {
        data?: {
          as_of: string;
          count: number;
          row_count: number;
          total_outstanding: number;
          rows: OverdueRow[];
        };
      };
      if (json.data) {
        setRows(json.data.rows);
        setSummary({
          as_of: json.data.as_of,
          count: json.data.count,
          row_count: json.data.row_count,
          total_outstanding: json.data.total_outstanding,
        });
      }

      // The filter options come from the same tables the list does, loaded once.
      const [structureRes, batchRes] = await Promise.all([
        fetch("/api/admin/payment-structures", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/public/batches", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (structureRes.ok) {
        const sj = (await structureRes.json()) as { structures?: Array<{ id: string; name: string }> };
        setStructures(sj.structures ?? []);
      }
      if (batchRes.ok) {
        const bj = (await batchRes.json()) as { data?: { batches?: string[] } };
        setBatches(bj.data?.batches ?? []);
      }
    } catch {
      setError("Could not load the overdue list.");
    } finally {
      setLoading(false);
    }
  }, [structureId, batch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-lg font-semibold">Overdue</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Members whose paid amount is below what was due by today
          {summary ? ` (${churchTodayLabel(summary.as_of)})` : ""}.
        </p>
      </div>

      {summary ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <dt className="text-sm text-[var(--text-muted)]">Members behind</dt>
            <dd className="mt-1 text-2xl font-semibold">{summary.count}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <dt className="text-sm text-[var(--text-muted)]">Outstanding</dt>
            <dd className="mt-1 text-2xl font-semibold">{formatPeso(summary.total_outstanding)}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <dt className="text-sm text-[var(--text-muted)]">Structures behind on</dt>
            <dd className="mt-1 text-2xl font-semibold">{summary.row_count}</dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">Structure</span>
          <select
            className="mt-1 min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            value={structureId}
            onChange={(e) => setStructureId(e.target.value)}
          >
            <option value="">All structures</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Batch</span>
          <select
            className="mt-1 min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
          >
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <a
          href={csvHref}
          className="min-h-12 rounded-xl border border-[var(--border)] px-4 text-sm font-medium leading-[3rem]"
        >
          Export CSV
        </a>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
          Nobody is behind on these structures. That is a good month.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Members with an outstanding balance, largest first</caption>
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th scope="col" className="py-2 pr-3 font-medium">Member</th>
                <th scope="col" className="py-2 pr-3 font-medium">Structure</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Due to date</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Outstanding</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Months late</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = truncateName(row.memberName);
                return (
                  <tr key={`${row.structureId}:${row.memberId}`} className="border-t border-[var(--border)]">
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {name.text}
                      <span className="block text-xs text-[var(--text-muted)]">
                        {row.batch ? `Batch ${row.batch}` : "No batch"}
                      </span>
                    </th>
                    <td className="py-2 pr-3">{row.structureName}</td>
                    <td className="py-2 pr-3 text-right">{formatPeso(row.due)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{formatPeso(row.remaining)}</td>
                    <td className="py-2 pr-3 text-right">{row.monthsOverdue}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setLedgerMemberId(row.memberId)}
                        className="min-h-11 rounded-xl border border-[var(--border)] px-3 text-sm"
                      >
                        Ledger
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ledgerMemberId ? (
        <LedgerView memberId={ledgerMemberId} onClose={() => setLedgerMemberId(null)} />
      ) : null}
    </div>
  );
}