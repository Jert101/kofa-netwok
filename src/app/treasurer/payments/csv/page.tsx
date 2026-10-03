"use client";

import { useEffect, useMemo, useState } from "react";
import { churchTodayLabel } from "@/lib/time/church-time-labels";

type Structure = { id: string; name: string; is_active: boolean };

/**
 * PAY-6: the payments CSV export form.
 *
 * A form that builds a plain link rather than a fetch, because following a link gives a real download
 * dialog with a filename. Fetching the CSV and synthesising a blob object URL to trigger the same thing
 * is thirty lines that reimplement a browser feature and gets the filename wrong about half the time.
 */
export default function TreasurerPaymentsCsvPage() {
  const [structures, setStructures] = useState<Structure[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [structureId, setStructureId] = useState("");
  const [today, setToday] = useState("");

  useEffect(() => {
    void (async () => {
      const [structureRes, tzRes] = await Promise.all([
        fetch("/api/admin/payment-structures", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/admin/settings", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (structureRes.ok) {
        const json = (await structureRes.json()) as { structures?: Structure[] };
        setStructures(json.structures ?? []);
      }
      if (tzRes.ok) {
        const json = (await tzRes.json()) as { data?: { report_timezone?: string } };
        try {
          setToday(
            new Intl.DateTimeFormat("en-CA", {
              timeZone: json.data?.report_timezone ?? "Asia/Manila",
            }).format(new Date()),
          );
        } catch {
          setToday(new Date().toISOString().slice(0, 10));
        }
      }
    })();
  }, []);

  const href = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (structureId) params.set("structure_id", structureId);
    const qs = params.toString();
    return qs ? `/api/treasurer/payments/csv?${qs}` : "/api/treasurer/payments/csv";
  }, [from, to, structureId]);

  const reversed = Boolean(from && to && from > to);

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-lg font-semibold">Export payments</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A CSV of every payment in the range, voided ones included and labelled. The parish bookkeeper
          needs to see that a receipt exists and was struck out, not to have it silently missing.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium">From</span>
          <input
            type="date"
            className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            value={from}
            max={today || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">To</span>
          <input
            type="date"
            className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            value={to}
            max={today || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Structure (optional)</span>
          <select
            className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            value={structureId}
            onChange={(e) => setStructureId(e.target.value)}
          >
            <option value="">All structures</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {reversed ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          The &ldquo;from&rdquo; date is after the &ldquo;to&rdquo; date.
        </p>
      ) : null}

      <a
        href={href}
        aria-disabled={reversed}
        className={
          "inline-flex min-h-12 items-center rounded-xl px-5 font-medium " +
          (reversed
            ? "pointer-events-none bg-[var(--surface-2)] text-[var(--text-muted)]"
            : "bg-[var(--brand)] text-white")
        }
      >
        Download CSV
      </a>

      <p className="text-sm text-[var(--text-muted)]">
        Leave the dates empty for everything. Payments with no date at all are left out of a date range
        rather than guessed into one.
        {today ? ` Today is ${churchTodayLabel(today)}.` : ""}
      </p>
    </div>
  );
}