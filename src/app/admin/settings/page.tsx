"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  MAX_AUDIT_RETENTION_MONTHS,
  MIN_AUDIT_RETENTION_MONTHS,
} from "@/lib/maintenance/retention";

function BatchManager() {
  const [batches, setBatches] = useState<{ id: string; year: string }[]>([]);
  const [year, setYear] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/member-batches", { credentials: "same-origin" });
    if (!res.ok) return;
    const j = (await res.json()) as { batches: { id: string; year: string }[] };
    setBatches(j.batches ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addBatch(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!/^\d{4}$/.test(year)) { setErr("Enter a valid 4-digit year."); return; }
    const res = await fetch("/api/admin/member-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ year }),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      setErr(j.error ?? "Could not add batch");
      return;
    }
    setYear("");
    load();
  }

  async function removeBatch(id: string) {
    await fetch("/api/admin/member-batches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id }),
    });
    load();
  }

  return (
    <div className="space-y-3">
      <form onSubmit={addBatch} className="flex gap-2">
        <input
          className="min-h-11 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
          placeholder="e.g. 2025"
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
          maxLength={4}
        />
        <button
          type="submit"
          className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white"
        >
          Add
        </button>
      </form>
      {err ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {err}
        </p>
      ) : null}
      {batches.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No batches added yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {batches.map((b) => (
            <div key={b.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm">
              <span>{b.year}</span>
              <button
                type="button"
                onClick={() => removeBatch(b.id)}
                className="text-[var(--danger)] leading-none"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminSettingsPage() {
  const [church_name, setChurchName] = useState("");
  const [church_address, setChurchAddress] = useState("");
  const [report_title, setReportTitle] = useState("");
  const [report_timezone, setReportTimezone] = useState("Asia/Manila");
  const [attendance_auto_approve_appeals, setAttendanceAutoApproveAppeals] = useState(false);
  const [auditRetentionMonths, setAuditRetentionMonths] = useState(12);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/settings", { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as {
        church_name: string;
        church_address: string;
        report_title: string;
        report_timezone: string;
        attendance_auto_approve_appeals?: boolean;
        audit_retention_months?: number;
      };
      setChurchName(j.church_name);
      setChurchAddress(j.church_address);
      setReportTitle(j.report_title);
      setReportTimezone(j.report_timezone);
      setAttendanceAutoApproveAppeals(j.attendance_auto_approve_appeals === true);
      setAuditRetentionMonths(j.audit_retention_months ?? 12);
    })();
  }, []);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        church_name,
        church_address,
        report_title,
        report_timezone,
        attendance_auto_approve_appeals,
        audit_retention_months: auditRetentionMonths,
      }),
    });
    setSaved(true);
  }

  return (
    <div className="space-y-10 pb-8">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">Report header</h2>
        <form onSubmit={saveSettings} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Church name</span>
            <input
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={church_name}
              onChange={(e) => setChurchName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Address</span>
            <input
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={church_address}
              onChange={(e) => setChurchAddress(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Report title</span>
            <input
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={report_title}
              onChange={(e) => setReportTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Timezone (IANA, e.g. Asia/Manila)</span>
            <input
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={report_timezone}
              onChange={(e) => setReportTimezone(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 rounded border-[var(--border)]"
              checked={attendance_auto_approve_appeals}
              onChange={(e) => setAttendanceAutoApproveAppeals(e.target.checked)}
            />
            <span className="text-sm text-[var(--text)]">
              Auto-approve attendance appeals
              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                When enabled, submitted attendance appeals are added directly to attendance without manual approval.
              </span>
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Audit log retention (months)</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_AUDIT_RETENTION_MONTHS}
              max={MAX_AUDIT_RETENTION_MONTHS}
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={auditRetentionMonths}
              onChange={(e) =>
                setAuditRetentionMonths(
                  Math.min(
                    MAX_AUDIT_RETENTION_MONTHS,
                    Math.max(
                      MIN_AUDIT_RETENTION_MONTHS,
                      Number.parseInt(e.target.value.replace(/\D/g, ""), 10) || MIN_AUDIT_RETENTION_MONTHS,
                    ),
                  ),
                )
              }
            />
            <span className="mt-1 block text-xs text-[var(--muted)]">
              How long activity records are kept before the daily sweep removes them. Shorter keeps
              less personal data; the default is 12 months.
            </span>
          </label>
          <button type="submit" className="min-h-12 w-full rounded-xl bg-[var(--accent)] font-semibold text-white">
            Save header
          </button>
          {saved ? <p className="text-sm text-[var(--muted)]">Saved.</p> : null}
        </form>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">Batch management</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Add or remove batch years used in member information.
        </p>
        <div className="mt-4 space-y-3">
          <BatchManager />
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">Security</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Role PINs, device sign-outs and login lockouts moved to their own page.
        </p>
        <Link
          href="/admin/security"
          className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white"
        >
          Open Security
        </Link>
      </section>
    </div>
  );
}
