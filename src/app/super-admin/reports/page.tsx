"use client";

import { useCallback, useEffect, useState } from "react";

type Report = {
  id: string;
  report_month: string;
  title: string;
  generated_by: string;
  created_at: string;
  status: string;
};

export default function SuperAdminReportsPage() {
  const [pending, setPending] = useState<Report[] | null>(null);
  const [approved, setApproved] = useState<Report[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);

  const load = useCallback(async () => {
    const [pRes, aRes] = await Promise.all([
      fetch("/api/super-admin/reports?status=pending", { credentials: "same-origin" }).then((r) => r.json()),
      fetch("/api/super-admin/reports?status=approved", { credentials: "same-origin" }).then((r) => r.json()),
    ]);
    setPending((pRes as { reports: Report[] }).reports ?? []);
    setApproved((aRes as { reports: Report[] }).reports ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAction(id: string, action: "approve" | "reject") {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/super-admin/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsgIsError(true);
        setMsg(j.error ?? "Could not update report");
        return;
      }
      setMsgIsError(false);
      setMsg(action === "approve" ? "Report approved." : "Report rejected.");
      load();
    } finally {
      setBusy(null);
    }
  }

  function ReportCard(r: Report) {
    const isPending = r.status === "pending";
    return (
      <li key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug text-[var(--text)]">{r.title}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {r.generated_by === "admin" ? "Admin" : "Secretary"} ·{" "}
              {new Date(r.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
                  className="min-h-11 rounded-xl bg-[var(--success)] px-4 text-sm font-semibold text-white disabled:opacity-40 dark:text-[var(--surface)]"
                  onClick={() => void handleAction(r.id, "approve")}
                >
                  {busy === r.id ? "Approving…" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={busy === r.id}
                  className="min-h-11 rounded-xl border border-[var(--danger)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40"
                  onClick={() => void handleAction(r.id, "reject")}
                >
                  {busy === r.id ? "Rejecting…" : "Reject"}
                </button>
              </>
            ) : (
              <span className="rounded-full bg-[var(--success-soft)] px-3 py-1 text-xs font-medium text-[var(--success)]">
                Approved
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

      <section>
        <h2 className="mb-3 text-base font-semibold text-[var(--text)]">
          Pending review
          {pending ? <span className="ml-2 text-xs text-[var(--muted)]">({pending.length})</span> : null}
        </h2>
        {pending === null ? (
          <p className="py-4 text-sm text-[var(--muted)]">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
            No reports pending review.
          </p>
        ) : (
          <ul className="space-y-3">{pending.map(ReportCard)}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-[var(--text)]">
          Approved
          {approved ? <span className="ml-2 text-xs text-[var(--muted)]">({approved.length})</span> : null}
        </h2>
        {approved === null ? (
          <p className="py-4 text-sm text-[var(--muted)]">Loading…</p>
        ) : approved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
            No approved reports yet.
          </p>
        ) : (
          <ul className="space-y-3">{approved.map(ReportCard)}</ul>
        )}
      </section>
    </div>
  );
}