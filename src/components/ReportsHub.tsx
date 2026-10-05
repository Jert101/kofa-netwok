"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildStatusStrip,
  describeWait,
  isDownloadable,
  monthLabelFrom,
  statusLabel,
  type ReportRowView,
} from "@/lib/reports/hub";
import { ReportWizard } from "@/components/ReportWizard";
import { ReportSnapshotView, fetchSnapshot, type SnapshotPayload } from "@/components/ReportSnapshotView";

/**
 * RPT-1 status strip + past reports table.
 *
 * The strip's copy and the rows' buttons both come from pure helpers in `lib/reports/hub`,
 * not from checks made here. The previous inline version derived the same answer in five
 * places from separate booleans, which is how "Outside schedule" ended up able to render on a
 * month whose report was already waiting for approval.
 */

type Gate = {
  schedule_allowed: boolean;
  report_exists: boolean;
  month_start: string | null;
  /** Church timezone, sent by the server. Never taken from the browser. */
  time_zone?: string;
  /** Status of the month's active report, or null when none exists. */
  report_status?: "pending" | "approved" | "rejected" | null;
  previous_month_start: string | null;
  previous_report_exists: boolean;
  can_generate_previous_month: boolean;
};

type Detail = SnapshotPayload;

type Props = {
  /** Admin can bypass the schedule and archive past months. */
  isAdmin: boolean;
};

const TONE_CLASSES: Record<string, string> = {
  ready: "bg-[var(--brand-soft)] text-[var(--brand)]",
  waiting: "bg-[var(--surface-2)] text-[var(--text-muted)]",
  blocked: "bg-[var(--surface-2)] text-[var(--text-muted)]",
  neutral: "bg-[var(--success-soft)] text-[var(--success)]",
};

const STATUS_CLASSES: Record<string, string> = {
  approved: "bg-[var(--success-soft)] text-[var(--success)]",
  pending: "bg-[var(--brand-soft)] text-[var(--brand)]",
  rejected: "bg-[var(--danger)]/10 text-[var(--danger)]",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_CLASSES[status] ?? "bg-[var(--surface-2)] text-[var(--text-muted)]"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}

export function ReportsHub({ isAdmin }: Props) {
  const [reports, setReports] = useState<ReportRowView[] | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** Distinct from `msg`: this means the page could not be read, and the sections below would
   *  otherwise carry the wait-fields' "Loading…" forever. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; data: Detail } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  // RPT-6: archiving removes live attendance, so it is confirmed rather than toggled.
  const [archiveConfirm, setArchiveConfirm] = useState<ReportRowView | null>(null);
  // RPT-2: the generate wizard, opened from the status strip.
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [rList, rGate] = await Promise.all([
        fetch("/api/reports", { credentials: "same-origin" }).then((r) => r.json()),
        fetch("/api/reports/can-generate", { credentials: "same-origin" }).then((r) => r.json()),
      ]);
      if (Array.isArray((rList as { reports?: unknown }).reports)) {
        setReports((rList as { reports: ReportRowView[] }).reports);
      } else {
        // A failed or malformed read used to become an empty list, which reads as "there are no
        // past reports" -- the same shape as an honest empty. That is not a safe default for the
        // thing an admin or secretary is about to act on, so it is reported instead.
        setLoadError("Could not load the reports.");
        setReports(null);
        return;
      }
      if (rGate && typeof rGate === "object" && "month_start" in rGate) {
        setGate(rGate as Gate);
      } else {
        setLoadError("Could not load this month's report window.");
      }
    } catch {
      setLoadError("Could not load the reports. Check your connection.");
      setReports(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The strip is built from the same pure function the tests cover, fed by the server's
   * church timezone.
   *
   * An earlier version of this component re-derived the four states inline from
   * `schedule_allowed` and `report_exists`, on the reasoning that `can-generate` did not send
   * a timezone. That left `buildStatusStrip` with 25 tests and no callers: tested copy that
   * nothing renders cannot break, but also never runs. The route now sends `time_zone` and
   * `report_status`, so the tested function is the one in the component.
   *
   * The server sends the zone precisely so the browser's own timezone is not used — a user
   * travelling or on a device set to another zone would otherwise be told the window had
   * opened when the church's had not.
   */
  const strip = useMemo(() => {
    if (!gate?.month_start) return null;
    return buildStatusStrip({
      monthStart: gate.month_start,
      now: new Date(),
      timeZone: gate.time_zone ?? "UTC",
      existingStatus: gate.report_status ?? null,
      canBypass: isAdmin,
    });
  }, [gate, isAdmin]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const result = await fetchSnapshot(id);
      if (!result.ok) {
        setMsg(result.error);
        return;
      }
      setDetail({ id, data: result.data });
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmArchive() {
    const target = archiveConfirm;
    if (!target) return;
    setArchivingId(target.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/reports/${target.id}/archive-data`, {
        method: "POST",
        credentials: "same-origin",
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not archive attendance.");
        return;
      }
      setMsg(`${target.monthLabel} attendance has been moved to the archive.`);
      setArchiveConfirm(null);
      void load();
    } finally {
      setArchivingId(null);
    }
  }

  const now = Date.now();

  return (
    <div className="space-y-8">
      <section
        aria-live="polite"
        className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
      >
        <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <h2 className="text-base font-semibold tracking-tight text-[var(--text)]">
            {gate?.month_start ? `${monthLabelFrom(gate.month_start)} report` : "Monthly report"}
          </h2>
        </div>
        <div className="space-y-3 p-4">
          {loadError ? (
            <div role="alert">
              <p className="text-sm text-[var(--danger)]">{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-2 text-sm font-medium text-[var(--brand)] underline"
              >
                Try again
              </button>
            </div>
          ) : strip ? (
            <div className="flex flex-col gap-2">
              <span
                className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                  TONE_CLASSES[strip.tone] ?? TONE_CLASSES.neutral
                }`}
              >
                {strip.label}
              </span>
              <p className="text-sm leading-relaxed text-[var(--text-muted)]">{strip.detail}</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          )}

          {strip && !gate?.report_exists ? (
            <button
              type="button"
              disabled={strip.tone !== "ready"}
              onClick={() => setWizardOpen(true)}
              className={`min-h-12 w-full rounded-xl text-sm font-semibold ${
                strip.tone === "ready"
                  ? "bg-[var(--brand)] text-white shadow-sm"
                  : "bg-[var(--surface-2)] text-[var(--text-muted)] opacity-60"
              }`}
            >
              {strip.tone === "ready" ? "Generate report" : "Generate unavailable"}
            </button>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-2 border-b border-[var(--border)] pb-2">
          <h2 className="text-base font-semibold text-[var(--text)]">Past reports</h2>
          {reports ? <span className="text-xs text-[var(--text-muted)]">{reports.length} saved</span> : null}
        </div>

        {msg ? (
          <p
            role="status"
            className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)]"
          >
            {msg}
          </p>
        ) : null}

        {reports === null && !loadError ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">Loading…</p>
        ) : reports === null ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            The reports could not be loaded.
          </p>
        ) : reports.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--text-muted)]">
            No reports yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug text-[var(--text)]">{r.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                      <StatusBadge status={r.status} />
                      <span>{r.generatedBy}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={r.generatedAt}>
                        {new Date(r.generatedAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                      {r.status === "pending" ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>waiting {describeWait(r.generatedAt, new Date(now))}</span>
                        </>
                      ) : null}
                    </p>

                    {r.reviewedAt ? (
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        Reviewed by {r.reviewedBy ?? "super admin"} on{" "}
                        {new Date(r.reviewedAt).toLocaleString(undefined, { dateStyle: "medium" })}
                      </p>
                    ) : null}

                    {r.reviewNote ? (
                      <p className="mt-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-2.5 py-2 text-sm text-[var(--text)]">
                        <span className="font-medium">Reason returned: </span>
                        {r.reviewNote}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {/* Download only where the PDF route will actually serve it. */}
                    {isDownloadable(r.status) ? (
                      <a
                        href={`/api/reports/${r.id}/pdf`}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white"
                      >
                        Download PDF
                      </a>
                    ) : (
                      <span className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--surface-2)] px-4 text-sm text-[var(--text-muted)]">
                        {statusLabel(r.status)}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => void openDetail(r.id)}
                      disabled={detailLoading}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--text)] disabled:opacity-50"
                    >
                      Details
                    </button>

                    {isDownloadable(r.status) ? (
                      <>
                        <a
                          href={`/api/reports/${r.id}/export?format=xlsx`}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--text)]"
                        >
                          XLSX
                        </a>
                        <a
                          href={`/api/reports/${r.id}/export?format=csv`}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--text)]"
                        >
                          CSV
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>

                {isAdmin && isDownloadable(r.status) ? (
                  <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text)]">Data in archive</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {r.dataArchived
                          ? "This month's live Mass sessions and attendance were moved to the archive."
                          : "Still in daily entry. Archiving copies this month's sessions and attendance to the archive and removes them from live tables."}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={r.dataArchived || archivingId !== null}
                      onClick={() => setArchiveConfirm(r)}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--text)] disabled:opacity-50"
                    >
                      {r.dataArchived ? "Archived" : archivingId === r.id ? "Archiving…" : "Archive…"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {wizardOpen && gate?.month_start ? (
        <ReportWizard
          monthStart={gate.month_start}
          isAdmin={isAdmin}
          onClose={() => setWizardOpen(false)}
          onGenerated={() => {
            setMsg(null);
            void load();
          }}
        />
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
            className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
          >
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 id="detail-title" className="text-lg font-semibold text-[var(--text)]">
                {detail.data.monthLabel ?? "Report"} details
              </h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <ReportSnapshotView snapshot={detail.data} pdfHref={`/api/reports/${detail.id}/pdf`} />
            </div>
            <div className="border-t border-[var(--border)] p-3">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="min-h-11 w-full rounded-xl bg-[var(--brand)] px-5 text-sm font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {archiveConfirm ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="archive-confirm-title"
            aria-describedby="archive-confirm-body"
            className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
          >
            <h2 id="archive-confirm-title" className="text-lg font-semibold text-[var(--text)]">
              Archive {archiveConfirm.monthLabel}?
            </h2>
            <p id="archive-confirm-body" className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
              Move {archiveConfirm.monthLabel} sessions and attendance to the archive and remove them
              from live tables? This cannot be undone.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setArchiveConfirm(null)}
                disabled={archivingId !== null}
                className="min-h-12 flex-1 rounded-xl border border-[var(--border)] text-sm font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmArchive()}
                disabled={archivingId !== null}
                className="min-h-12 flex-1 rounded-xl bg-[var(--brand)] text-sm font-semibold text-white disabled:opacity-50"
              >
                {archivingId !== null ? "Archiving…" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}