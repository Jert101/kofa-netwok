"use client";

import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";

type Report = {
  id: string;
  report_month: string;
  title: string;
  generated_by: string;
  created_at: string;
  data_archived?: boolean;
};

type GateState = {
  allowed: boolean;
  reason: string | null;
  schedule_allowed: boolean;
  report_exists: boolean;
  month_start: string | null;
};

type MonthSessionRow = {
  id: string;
  session_date: string;
  weekday_label: string;
  mass_name: string;
};

type Props = {
  showAdminScheduleBypass?: boolean;
  /** Admin only: optional archiving when generating + control beside each past report. */
  showArchiveToggle?: boolean;
};

function ArchiveSwitch({
  checked,
  disabled,
  onCheckedChange,
  "aria-labelledby": labelledBy,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
  "aria-labelledby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
      className={`relative inline-flex h-8 w-[3.25rem] shrink-0 rounded-full border border-black/10 transition-colors dark:border-white/10 ${
        checked ? "bg-[var(--accent)]" : "bg-zinc-300 dark:bg-zinc-600"
      } ${disabled ? "cursor-default opacity-60" : "cursor-pointer"}`}
    >
      <span
        className={`pointer-events-none absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[1.35rem]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function ReportsPanel({ showAdminScheduleBypass = false, showArchiveToggle = false }: Props) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [bypassOpen, setBypassOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [monthSessions, setMonthSessions] = useState<MonthSessionRow[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [archiveAfterGenerate, setArchiveAfterGenerate] = useState(true);
  const [archivingReportId, setArchivingReportId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rList, rGate] = await Promise.all([
      fetch("/api/reports", { credentials: "same-origin" }).then((r) => r.json()),
      fetch("/api/reports/can-generate", { credentials: "same-origin" }).then((r) => r.json()),
    ]);
    setReports((rList as { reports: Report[] }).reports ?? []);
    const g = rGate as {
      allowed?: boolean;
      reason?: string | null;
      schedule_allowed?: boolean;
      report_exists?: boolean;
      month_start?: string;
    };
    setGate({
      allowed: Boolean(g.allowed),
      reason: g.reason ?? null,
      schedule_allowed: g.schedule_allowed !== false,
      report_exists: g.report_exists === true,
      month_start: typeof g.month_start === "string" ? g.month_start : null,
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fetchMonthSessions = useCallback(async () => {
    if (!gate?.month_start || gate.report_exists) return;
    setSessionsLoading(true);
    try {
      const res = await fetch(
        `/api/reports/month-sessions?month_start=${encodeURIComponent(gate.month_start)}`,
        { credentials: "same-origin" }
      );
      const j = (await res.json()) as { sessions?: MonthSessionRow[]; error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not load sessions");
        setMonthSessions([]);
        setSelectedIds(new Set());
        return;
      }
      const rows = j.sessions ?? [];
      setMonthSessions(rows);
      setSelectedIds(new Set(rows.map((s) => s.id)));
    } finally {
      setSessionsLoading(false);
    }
  }, [gate?.month_start, gate?.report_exists]);

  useEffect(() => {
    if (!gate?.month_start || gate.report_exists) {
      setMonthSessions(null);
      setSelectedIds(new Set());
      return;
    }
    fetchMonthSessions();
  }, [gate?.month_start, gate?.report_exists, fetchMonthSessions]);

  function toggleSession(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectAll() {
    if (!monthSessions) return;
    setSelectedIds(new Set(monthSessions.map((s) => s.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function generate(bypass_schedule: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      setMsg("Select at least one Mass session to include in the report.");
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          session_ids: ids,
          ...(bypass_schedule ? { bypass_schedule: true } : {}),
          ...(showArchiveToggle ? { archive_data: archiveAfterGenerate } : {}),
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not generate");
        return;
      }
      if (showArchiveToggle && !archiveAfterGenerate) {
        setMsg(
          bypass_schedule
            ? "Report generated (schedule override). Live attendance was not archived — use the switch beside this report when you are ready."
            : "Report generated. Live attendance was not archived — use the switch beside this report when you are ready."
        );
      } else {
        setMsg(
          bypass_schedule
            ? "Report generated (schedule override). Attendance for that month has been archived."
            : "Report generated. Attendance for that month has been archived."
        );
      }
      setBypassOpen(false);
      setPreviewOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  const showBypass =
    showAdminScheduleBypass && gate && !gate.report_exists && !gate.schedule_allowed;

  const selectedCount = selectedIds.size;
  const canGenerate =
    gate &&
    !gate.report_exists &&
    (gate.allowed || showAdminScheduleBypass) &&
    selectedCount > 0 &&
    !sessionsLoading;

  async function archiveReportData(reportId: string) {
    setMsg(null);
    setArchivingReportId(reportId);
    try {
      const res = await fetch(`/api/reports/${reportId}/archive-data`, {
        method: "POST",
        credentials: "same-origin",
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not archive attendance");
        return;
      }
      setMsg("Attendance for that month has been moved to the archive.");
      load();
    } finally {
      setArchivingReportId(null);
    }
  }

  function formatSessionLabel(s: MonthSessionRow) {
    try {
      const d = format(parseISO(s.session_date), "EEE, MMM d, yyyy");
      return `${d} · ${s.mass_name}`;
    } catch {
      return `${s.session_date} · ${s.mass_name}`;
    }
  }

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <h2 className="text-base font-semibold tracking-tight text-[var(--text)]">Generate monthly report</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            Preview Mass days in the report month that have at least one attendance record (weekdays and weekends).
            Check the boxes for columns to include in the PDF. Remarks count only the Masses you include.
          </p>
        </div>

        <div className="space-y-4 p-4">
          {gate ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Status</span>
              {gate.report_exists ? (
                <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                  Report already exists for this month
                </span>
              ) : gate.allowed ? (
                <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
                  Ready to generate
                </span>
              ) : (
                <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                  Outside schedule
                </span>
              )}
            </div>
          ) : null}

          {gate && !gate.allowed && !showBypass ? (
            <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)]">{gate.reason}</p>
          ) : null}

          {!gate?.report_exists ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setPreviewOpen(true);
                  if (!monthSessions && gate?.month_start) fetchMonthSessions();
                }}
                disabled={!gate?.month_start || sessionsLoading}
                className="min-h-12 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold text-[var(--text)] disabled:opacity-40"
              >
                {sessionsLoading ? "Loading sessions…" : "Preview & select Masses"}
              </button>
              <p className="self-center text-sm text-[var(--muted)]">
                {monthSessions === null && !sessionsLoading
                  ? "…"
                  : `${selectedCount} of ${monthSessions?.length ?? 0} selected`}
              </p>
            </div>
          ) : null}

          {showArchiveToggle && !gate?.report_exists ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p id="archive-pre-label" className="text-sm font-medium text-[var(--text)]">
                    Put data in archive?
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                    When on, generating moves this month&apos;s Mass sessions and attendance into the archive and clears
                    them from daily entry. When off, the PDF is still saved and you can archive later from Past reports.
                  </p>
                </div>
                <ArchiveSwitch
                  aria-labelledby="archive-pre-label"
                  checked={archiveAfterGenerate}
                  onCheckedChange={setArchiveAfterGenerate}
                />
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => generate(false)}
            disabled={busy || !canGenerate || !gate?.allowed}
            className="min-h-12 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? "Working…" : "Generate report"}
          </button>

          {showBypass ? (
            <div className="rounded-xl border border-[var(--border)] bg-gradient-to-b from-[var(--accent-soft)] to-transparent p-4">
              <p className="text-sm font-semibold text-[var(--text)]">Admin override</p>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                Generate before the usual window. Use the same session selection as above.
              </p>
              <button
                type="button"
                disabled={busy || selectedCount === 0}
                onClick={() => setBypassOpen(true)}
                className="mt-4 min-h-12 w-full rounded-xl border-2 border-[var(--accent)]/45 bg-[var(--surface)] text-sm font-semibold text-[var(--accent)] disabled:opacity-40"
              >
                Generate anyway (bypass schedule)
              </button>
            </div>
          ) : null}

          {msg ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)]">
              {msg}
            </p>
          ) : null}
        </div>
      </section>

      {previewOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:max-w-2xl"
          >
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 id="preview-title" className="text-lg font-semibold text-[var(--text)]">
                Report month sessions
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Only days with recorded attendance are listed. Include a Mass in the PDF by keeping its box checked.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {sessionsLoading ? (
                <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
              ) : !monthSessions?.length ? (
                <p className="py-8 text-center text-sm text-[var(--muted)]">
                  No Mass sessions with attendance recorded for this month yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {monthSessions.map((s) => (
                    <li key={s.id}>
                      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-[var(--surface-2)]">
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 rounded border-[var(--border)]"
                          checked={selectedIds.has(s.id)}
                          onChange={(e) => toggleSession(s.id, e.target.checked)}
                        />
                        <span className="text-sm leading-snug text-[var(--text)]">{formatSessionLabel(s)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-[var(--border)] p-3">
              <button
                type="button"
                onClick={selectAll}
                className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm font-medium"
                disabled={!monthSessions?.length}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm font-medium"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="ml-auto min-h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bypassOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 backdrop-blur-[2px] sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bypass-title"
            className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
          >
            <h2 id="bypass-title" className="text-lg font-semibold text-[var(--text)]">
              Bypass schedule?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              Generate with {selectedCount} Mass column{selectedCount === 1 ? "" : "s"} selected.{" "}
              {archiveAfterGenerate
                ? "Attendance for the full month will be moved to the archive after the PDF is created."
                : "Live attendance will stay in the app until you archive from Past reports."}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setBypassOpen(false)}
                className="min-h-12 flex-1 rounded-xl border border-[var(--border)] text-sm font-medium"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => generate(true)}
                disabled={busy || selectedCount === 0}
                className="min-h-12 flex-1 rounded-xl bg-[var(--accent)] text-sm font-semibold text-white"
              >
                {busy ? "…" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-end justify-between gap-2 border-b border-[var(--border)] pb-2">
          <h2 className="text-base font-semibold text-[var(--text)]">Past reports</h2>
          {reports && reports.length > 0 ? (
            <span className="text-xs text-[var(--muted)]">{reports.length} saved</span>
          ) : null}
        </div>
        {reports === null ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
            No reports yet. Generate one when the schedule allows.
          </p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => {
              const archived = r.data_archived !== false;
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug text-[var(--text)]">{r.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {r.generated_by === "admin" ? "Admin" : "Secretary"} ·{" "}
                        {new Date(r.created_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    <a
                      href={`/api/reports/${r.id}/pdf`}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white shadow-sm active:scale-[0.99] sm:self-start"
                    >
                      Download PDF
                    </a>
                  </div>
                  {showArchiveToggle ? (
                    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p id={`archive-post-${r.id}`} className="text-sm font-medium text-[var(--text)]">
                          Data in archive
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {archived
                            ? "Live Mass sessions and attendance for this month were moved to the archive."
                            : "Not moved yet — turn the switch on to copy this month’s live data to the archive and clear it from daily entry."}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 sm:shrink-0">
                        {archivingReportId === r.id ? (
                          <span className="text-xs text-[var(--muted)]">Archiving…</span>
                        ) : null}
                        <ArchiveSwitch
                          aria-labelledby={`archive-post-${r.id}`}
                          checked={archived}
                          disabled={archived || archivingReportId !== null}
                          onCheckedChange={(next) => {
                            if (next && !archived) void archiveReportData(r.id);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
