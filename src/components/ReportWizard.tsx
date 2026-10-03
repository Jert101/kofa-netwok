import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildPreviewWarnings,
  canProceedFromSessions,
  computeSelection,
  summarizeConfirm,
  toggleId,
  type WizardSession,
} from "@/lib/reports/wizard";
import { monthLabelFrom } from "@/lib/reports/hub";
import { normaliseTotals } from "@/lib/reports/snapshot";

/**
 * RPT-2: three steps — choose sessions, review the grid, generate.
 *
 * The preview grid comes from `/api/reports/preview`, which shares `buildReportGrid` with the
 * generate path. It is still not trusted: the server rebuilds the grid when it writes the
 * report, so this shows what will be produced, not what will be saved.
 */

type Preview = {
  month_label: string;
  columns: unknown[];
  rows: { memberId?: string; name?: string; cells?: unknown[]; served?: number; remarks?: string }[];
  totals: Record<string, unknown> | null;
  pending_appeals_warning: string | null;
};

type Props = {
  monthStart: string;
  isAdmin: boolean;
  onClose: () => void;
  onGenerated: () => void;
};

type Step = "sessions" | "grid" | "confirm";

export function ReportWizard({ monthStart, isAdmin, onClose, onGenerated }: Props) {
  const [step, setStep] = useState<Step>("sessions");
  const [sessions, setSessions] = useState<WizardSession[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveAfter, setArchiveAfter] = useState(true);
  /** Set after a 409 so Generate is retried with the acknowledgement flag. */
  const [acknowledge, setAcknowledge] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await fetch(`/api/reports/month-sessions?month_start=${monthStart}`, {
      credentials: "same-origin",
    });
    const j = (await res.json()) as { sessions?: WizardSession[]; error?: string };
    if (!res.ok) {
      setError(j.error ?? "Could not load this month's Mass sessions.");
      setSessions([]);
      return;
    }
    const list = j.sessions ?? [];
    setSessions(list);
    // Every session starts included: the common case is "report the month as it happened",
    // and an empty default would make a secretary hunt for the boxes they wanted.
    setSelected(list.map((s) => s.id));
  }, [monthStart]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const sel = useMemo(
    () => computeSelection(sessions ?? [], selected),
    [sessions, selected],
  );

  /**
   * Normalised once and reused. The preview endpoint hands back the builder's camelCase totals,
   * which `normaliseTotals` accepts; reading the keys directly worked only because the wizard
   * happens to be the caller that speaks that dialect. One reader for both shapes.
   */
  const totals = useMemo(() => normaliseTotals(preview?.totals ?? null), [preview?.totals]);

  const warnings = useMemo(
    () =>
      buildPreviewWarnings({
        pendingAppeals: preview?.pending_appeals_warning ? 1 : 0,
        zeroAttendanceMembers: totals.zeroAttendanceMembers ?? 0,
        selectedSessions: sel.selectedIds.length,
      }),
    [preview?.pending_appeals_warning, totals.zeroAttendanceMembers, sel.selectedIds.length],
  );

  async function buildPreview() {
    if (!canProceedFromSessions(sel.selectedIds.length)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ month_start: monthStart, session_ids: sel.selectedIds }),
      });
      const j = (await res.json()) as Preview & { error?: string };
      if (!res.ok) {
        setError(j.error ?? "Could not build the report preview.");
        return;
      }
      setPreview(j);
      setStep("grid");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          month_start: monthStart,
          session_ids: sel.selectedIds,
          archive_data: archiveAfter,
          acknowledge_pending_appeals: acknowledge,
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        reportId?: string;
        error?: string;
        code?: string;
        pending_appeals?: number;
      };
      if (!res.ok) {
        setError(j.error ?? "Could not generate the report.");
        // 409 means the month has unreviewed appeals. Generation refuses rather than silently
        // generating a report those members would later have to dispute, so the retry needs
        // the explicit acknowledgement the server asks for.
        if (j.code === "PENDING_APPEALS") setAcknowledge(true);
        return;
      }
      setDoneId(j.reportId ?? null);
      setStep("confirm");
    } finally {
      setBusy(false);
    }
  }

  const month = monthLabelFrom(monthStart);
  const sessionsInMonth = sessions?.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 id="wizard-title" className="text-lg font-semibold text-[var(--text)]">
            {month} report
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {doneId
              ? "Report generated."
              : step === "sessions"
                ? "Step 1 of 3 · Choose Mass sessions"
                : step === "grid"
                  ? "Step 2 of 3 · Review the grid"
                  : "Step 3 of 3 · Confirm"}
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="mx-4 mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2.5 text-sm text-[var(--text)]"
          >
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {step === "sessions" ? (
            sessions === null ? (
              <p className="py-8 text-center text-sm text-[var(--text-muted)]">Loading Mass sessions…</p>
            ) : sessions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--text-muted)]">
                No Mass sessions with attendance were recorded for {month}.
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-[var(--text-muted)]">
                  Tick the sessions to include as columns. {sel.medianAttendance > 0
                    ? `Typical attendance this month is ${sel.medianAttendance}.`
                    : ""}
                </p>
                <ul className="space-y-2">
                  {(sessions ?? []).map((s) => {
                    const isLow = sel.lowTurnoutIds.has(s.id);
                    const on = sel.selectedIds.includes(s.id);
                    return (
                      <li key={s.id}>
                        <label
                          className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 ${
                            on
                              ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                              : "border-[var(--border)]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setSelected((prev) => toggleId(prev, s.id))}
                            className="h-5 w-5 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-[var(--text)]">
                              {s.mass_name} · {s.weekday_label}
                            </span>
                            <span className="block text-xs text-[var(--text-muted)]">{s.session_date}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-semibold text-[var(--text)]">
                              {s.attendance_count ?? 0}
                            </span>
                            <span className="block text-[0.65rem] uppercase tracking-wide text-[var(--text-muted)]">
                              attended
                            </span>
                          </span>
                          {isLow ? (
                            <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[0.65rem] font-medium text-[var(--text-muted)]">
                              Low turnout
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )
          ) : null}

          {step === "grid" && preview ? (
            <>
              {preview.pending_appeals_warning ? (
                <p className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)]">
                  {preview.pending_appeals_warning}
                </p>
              ) : null}

              {warnings.messages.length > 0 ? (
                <ul className="mb-3 space-y-2">
                  {warnings.messages.map((m) => (
                    <li
                      key={m}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)]"
                    >
                      {m}
                    </li>
                  ))}
                </ul>
              ) : null}

              <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Masses</dt>
                  <dd className="text-lg font-semibold text-[var(--text)]">
                    {totals.sessionsInReport ?? sel.selectedIds.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Attendance</dt>
                  <dd className="text-lg font-semibold text-[var(--text)]">
                    {totals.attendance ?? sel.totalAttendance}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Members</dt>
                  <dd className="text-lg font-semibold text-[var(--text)]">
                    {totals.memberCount ?? preview.rows.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">No attendance</dt>
                  <dd className="text-lg font-semibold text-[var(--text)]">
                    {totals.zeroAttendanceMembers ?? 0}
                  </dd>
                </div>
              </dl>

              {/* S/A only, per the user's decision. Every cell is one of two marks. */}
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Attendance grid for {month}</caption>
                  <thead>
                    <tr className="bg-[var(--surface-2)]">
                      <th scope="col" className="px-3 py-2 text-left font-medium text-[var(--text)]">
                        Member
                      </th>
                      <th scope="col" className="px-2 py-2 text-center font-medium text-[var(--text)]">
                        Served
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={r.memberId ?? i} className="border-t border-[var(--border)]">
                        <th
                          scope="row"
                          className="px-3 py-2 text-left font-normal text-[var(--text)]"
                        >
                          {r.name ?? "—"}
                        </th>
                        <td className="px-2 py-2 text-center text-[var(--text-muted)]">
                          {r.served === 0 ? "—" : `${r.served} S`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--text-muted)]">
                  No active members to list for this month.
                </p>
              ) : null}
            </>
          ) : null}

          {step === "confirm" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--success)]/30 bg-[var(--success)]/5 px-4 py-3">
                <p className="text-sm font-semibold text-[var(--text)]">
                  {month} report generated and sent for super admin approval.
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  It appears in Past reports as pending, and becomes downloadable once approved.
                </p>
              </div>
              <ul className="space-y-1.5">
                {summarizeConfirm({
                  monthLabel: month,
                  selectedCount: sel.selectedIds.length,
                  totalSessionsInMonth: sessionsInMonth,
                  archiveAfterGenerate: archiveAfter,
                }).map((line) => (
                  <li key={line} className="flex gap-2 text-sm text-[var(--text-muted)]">
                    <span aria-hidden="true">·</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="border-t border-[var(--border)] p-3">
          {step === "confirm" ? (
            <button
              type="button"
              onClick={() => {
                onGenerated();
                onClose();
              }}
              className="min-h-12 w-full rounded-xl bg-[var(--brand)] px-5 text-sm font-semibold text-white"
            >
              Done
            </button>
          ) : (
            <>
              {step === "grid" && isAdmin ? (
                <label className="mb-3 flex items-start gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={archiveAfter}
                    onChange={(e) => setArchiveAfter(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0"
                  />
                  <span className="text-sm text-[var(--text)]">
                    Move this month&apos;s attendance to the archive after generating.
                    <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                      Off keeps attendance in daily entry until you archive it from Past reports.
                    </span>
                  </span>
                </label>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (step === "grid" ? setStep("sessions") : onClose())}
                  className="min-h-12 flex-1 rounded-xl border border-[var(--border)] text-sm font-medium disabled:opacity-50"
                >
                  {step === "grid" ? "Back" : "Cancel"}
                </button>
                <button
                  type="button"
                  disabled={busy || !canProceedFromSessions(sel.selectedIds.length)}
                  onClick={() => (step === "sessions" ? void buildPreview() : void generate())}
                  className="min-h-12 flex-1 rounded-xl bg-[var(--brand)] text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy
                    ? step === "sessions"
                      ? "Building…"
                      : "Generating…"
                    : step === "sessions"
                      ? "Review grid"
                      : acknowledge
                        ? "Close month anyway"
                        : "Generate report"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}