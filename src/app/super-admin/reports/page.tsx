"use client";

import { useCallback, useEffect, useState } from "react";
import {
  REPORT_REJECT_PRESETS,
  REVIEW_NOTE_MIN,
  describeRejection,
  presetLabel,
  validateReviewNote,
  type ReportRejectPresetId,
} from "@/lib/reports/review-reasons";
import { ReportSnapshotView, fetchSnapshot, type SnapshotPayload } from "@/components/ReportSnapshotView";
import { messageOf, readEnvelope } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

type Report = {
  id: string;
  report_month: string;
  title: string;
  generated_by: string;
  created_at: string;
  status: string;
  review_note?: string | null;
};

type RejectDraft = {
  reportId: string;
  monthLabel: string;
  preset: ReportRejectPresetId | null;
  note: string;
};

/**
 * RPT-3/RPT-4: review queue with a required reason on rejection.
 *
 * Reject opens a dialog instead of firing immediately. The previous version sent the PATCH
 * on a single click with no reason, which produced rejections the secretary could not act on —
 * the reason field was the one thing the old UI left out and the one thing the workflow needs.
 */
export default function SuperAdminReportsPage() {
  const [pending, setPending] = useState<Report[] | null>(null);
  const [approved, setApproved] = useState<Report[] | null>(null);
  const [rejected, setRejected] = useState<Report[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);
  const [draft, setDraft] = useState<RejectDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  // Separate from `msg`: this one means "the list could not be read", which must not be confused with a
  // successful action or with a genuinely empty queue.
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * RPT-4: the on-screen grid, so a report can be decided without opening the PDF.
   *
   * Fetched per report on demand rather than listed up front: the grid carries every member
   * name for the month, so loading it for the whole queue would turn a status page into the
   * payload this module exists to avoid.
   */
  const [preview, setPreview] = useState<{ id: string; data: SnapshotPayload } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function openPreview(id: string) {
    setPreviewLoading(id);
    setPreviewError(null);
    try {
      const result = await fetchSnapshot(id);
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      setPreview({ id, data: result.data });
    } finally {
      setPreviewLoading(null);
    }
  }

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const buckets = await Promise.all(
        (["pending", "approved", "rejected"] as const).map(async (status) => {
          const res = await fetch(`/api/super-admin/reports?status=${status}`, {
            credentials: "same-origin",
          });
          // A failed read used to fall through `?? []`, which showed the super admin a confident
          // "(0) / No reports pending review" for a queue it simply could not reach. An unreachable
          // queue and an empty one look identical that way, and only one of them is true.
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? `Could not load the ${status} reports.`);
          }
          const body = (await res.json()) as { reports?: Report[] };
          return body.reports ?? [];
        }),
      );
      setPending(buckets[0]);
      setApproved(buckets[1]);
      setRejected(buckets[2]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the reports.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAction(id: string, action: "approve" | "reject", body?: Record<string, unknown>) {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/super-admin/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body ?? { action }),
      });
      // `messageOf` rather than `j.error`: the route answers failures through `jsonError`, so `error` is an
      // object. Casting it to a string and rendering it threw "Objects are not valid as a React child"
      // on every 400/404/409 -- the approve and reject screen broke exactly when it had something to say.
      const env = await readEnvelope<{ status: string; review_note: string | null }>(res);
      if (!env || !env.ok) {
        setMsgIsError(true);
        setMsg(messageOf(env, "Could not update report"));
        return false;
      }
      setMsgIsError(false);
      setMsg(action === "approve" ? "Report approved." : "Report returned to the secretary.");
      void load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function submitReject() {
    if (!draft) return;
    // The same validator the route runs, checked here so the reason for refusal is shown
    // next to the fields that caused it instead of arriving as a server error.
    const check = validateReviewNote({ preset: draft.preset, note: draft.note });
    if (!check.ok) {
      setDraftError(check.message);
      return;
    }
    setDraftError(null);
    const ok = await handleAction(draft.reportId, "reject", {
      action: "reject",
      // Field names must match the route's zod schema (`preset` / `note`). Sending
      // `reason_preset` silently validates as nullish, which would turn every rejection into
      // a reason-less one instead of a 400.
      preset: draft.preset,
      note: draft.note,
    });
    if (ok) setDraft(null);
  }

  function ReportCard(r: Report) {
    const isPending = r.status === "pending";
    return (
      <li
        key={r.id}
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug text-[var(--text)]">{r.title}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {r.generated_by === "admin" ? "Admin" : "Secretary"} ·{" "}
              {new Date(r.created_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            {r.status === "rejected" && r.review_note ? (
              <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-sm text-[var(--text)]">
                {describeRejection(null, r.review_note)}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={previewLoading === r.id}
              onClick={() => void openPreview(r.id)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              {previewLoading === r.id ? "Loading…" : "Review grid"}
            </button>
            <a
              href={`/api/reports/${r.id}/pdf`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)]"
            >
              View PDF
            </a>
            {isPending ? (
              <>
                <button
                  type="button"
                  disabled={busy === r.id}
                  className="min-h-11 rounded-xl bg-[var(--success)] px-4 text-sm font-semibold text-white disabled:opacity-40"
                  onClick={() => void handleAction(r.id, "approve")}
                >
                  {busy === r.id ? "Approving…" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={busy === r.id}
                  className="min-h-11 rounded-xl border border-[var(--danger)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40"
                  onClick={() => {
                    setDraft({
                      reportId: r.id,
                      monthLabel: r.title,
                      preset: null,
                      note: "",
                    });
                    setDraftError(null);
                  }}
                >
                  Return…
                </button>
              </>
            ) : (
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  r.status === "rejected"
                    ? "bg-[var(--danger)]/10 text-[var(--danger)]"
                    : "bg-[var(--success-soft)] text-[var(--success)]"
                }`}
              >
                {r.status === "rejected" ? "Returned" : "Approved"}
              </span>
            )}
          </div>
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <h1 className="text-lg font-semibold sm:text-xl">Super Admin — Reports</h1>

      {msg ? (
        <p
          role={msgIsError ? "alert" : "status"}
          className={`rounded-xl border px-3 py-2.5 text-sm ${
            msgIsError
              ? "border-[var(--danger)] bg-[var(--surface)] text-[var(--danger)]"
              : "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]"
          }`}
        >
          {msg}
        </p>
      ) : null}

      {/*
        The counts below stay null on a failed read, so each section keeps saying "Loading…" instead of
        claiming a queue is empty. This banner says which of the two it is, and offers the one action
        that helps.
      */}
      {loadError ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--danger)] bg-[var(--surface)] p-4 text-sm text-[var(--danger)]"
        >
          <p className="font-medium">Could not load the reports.</p>
          <p className="mt-1">{loadError}</p>
          <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 text-base font-semibold text-[var(--text)]">
          Pending review
          {pending ? <span className="ml-2 text-xs text-[var(--text-muted)]">({pending.length})</span> : null}
        </h2>
        {pending === null ? (
          <p className="py-4 text-sm text-[var(--text-muted)]">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--text-muted)]">
            No reports pending review.
          </p>
        ) : (
          <ul className="space-y-3">{pending.map(ReportCard)}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-[var(--text)]">
          Approved
          {approved ? <span className="ml-2 text-xs text-[var(--text-muted)]">({approved.length})</span> : null}
        </h2>
        {approved === null ? (
          <p className="py-4 text-sm text-[var(--text-muted)]">Loading…</p>
        ) : approved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--text-muted)]">
            No approved reports yet.
          </p>
        ) : (
          <ul className="space-y-3">{approved.map(ReportCard)}</ul>
        )}
      </section>

      {rejected !== null && rejected.length > 0 ? (
        <section>
          <h2 className="mb-3 text-base font-semibold text-[var(--text)]">
            Returned
            <span className="ml-2 text-xs text-[var(--text-muted)]">({rejected.length})</span>
          </h2>
          <ul className="space-y-3">{rejected.map(ReportCard)}</ul>
        </section>
      ) : null}

      {previewError ? (
        <p role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--danger)]">
          {previewError}
        </p>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2 id="preview-title" className="text-lg font-semibold text-[var(--text)]">
                  {preview.data.monthLabel ?? "Report"} grid
                </h2>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Stored snapshot · this is what the PDF shows
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label="Close grid"
                className="min-h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              <ReportSnapshotView snapshot={preview.data} pdfHref={`/api/reports/${preview.id}/pdf`} />
              {/* Approve and return are repeated here so the decision can be made with the
                  grid on screen, rather than after closing it and re-locating the row. */}
              {pending?.some((p) => p.id === preview.id) ? (
                <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      if (await handleAction(preview.id, "approve")) setPreview(null);
                    }}
                    className="min-h-12 flex-1 rounded-xl bg-[var(--success)] px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy !== null ? "Working…" : "Approve this report"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      const row = pending?.find((p) => p.id === preview.id);
                      setPreview(null);
                      setDraft({
                        reportId: preview.id,
                        monthLabel: row?.title ?? preview.data.monthLabel ?? "Report",
                        preset: null,
                        note: "",
                      });
                      setDraftError(null);
                    }}
                    className="min-h-12 flex-1 rounded-xl border border-[var(--danger)] px-4 text-sm font-semibold text-[var(--danger)] disabled:opacity-50"
                  >
                    Return with a reason…
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {draft ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-title"
            className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
          >
            <h2 id="reject-title" className="text-lg font-semibold text-[var(--text)]">
              Return {draft.monthLabel}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              The secretary is notified with your reason.
            </p>

            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-medium text-[var(--text)]">Reason</legend>
              <div className="space-y-2">
                {REPORT_REJECT_PRESETS.map((p) => (
                  <label
                    key={p.id}
                    className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${
                      draft.preset === p.id
                        ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                        : "border-[var(--border)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="reject-preset"
                      checked={draft.preset === p.id}
                      onChange={() =>
                        setDraft((d) => (d ? { ...d, preset: p.id, note: "" } : d))
                      }
                      className="mt-0.5 h-5 w-5 shrink-0"
                    />
                    <span>
                      <span className="block text-sm font-medium text-[var(--text)]">{p.label}</span>
                      <span className="block text-xs text-[var(--text-muted)]">{p.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                Note {draft.preset && draft.preset !== "other" ? "(optional)" : ""}
              </span>
              <textarea
                value={draft.note}
                onChange={(e) => setDraft((d) => (d ? { ...d, note: e.target.value } : d))}
                rows={3}
                maxLength={500}
                aria-invalid={draftError !== null}
                aria-describedby={draftError ? "reject-error" : undefined}
                className="w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]"
              />
            </label>

            {draftError ? (
              <p id="reject-error" role="alert" className="mt-2 text-sm text-[var(--danger)]">
                {draftError}
              </p>
            ) : (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {draft.preset === "other"
                  ? "Required for “Other”, so the secretary knows what to change."
                  : draft.preset
                    ? `Optional. “${presetLabel(draft.preset)}” is sent if you leave this empty.`
                    : `Choose a reason. Notes need at least ${REVIEW_NOTE_MIN} characters.`}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setDraft(null)}
                className="min-h-12 flex-1 rounded-xl border border-[var(--border)] text-sm font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void submitReject()}
                className="min-h-12 flex-1 rounded-xl bg-[var(--danger)] text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy !== null ? "Returning…" : "Return report"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}