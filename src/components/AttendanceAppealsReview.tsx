"use client";

import { useCallback, useEffect, useState } from "react";

type AppealItem = {
  id: string;
  member_id: string;
  member_name: string;
  created_at: string;
  submitted_at: string | null;
};

export function AttendanceAppealsReview({
  sessionId,
  onAppealApproved,
}: {
  sessionId: string;
  /** Called after a successful approve so attendance UIs can reload from the server. */
  onAppealApproved?: () => void;
}) {
  const [items, setItems] = useState<AppealItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/attendance/session/${sessionId}/appeals`, { credentials: "same-origin" });
    if (!res.ok) {
      setItems([]);
      return;
    }
    const j = (await res.json()) as { appeals?: AppealItem[] };
    setItems(j.appeals ?? []);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, action: "approve" | "reject") {
    setMsg(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/attendance/appeals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not review appeal");
        return;
      }
      setMsg(action === "approve" ? "Appeal approved." : "Appeal rejected.");
      if (action === "approve") onAppealApproved?.();
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--accent)]">Attendance appeals</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Pending appeals only; resolved appeals are removed to keep the list and database lean.
      </p>

      {items === null ? (
        <p className="mt-3 text-sm text-[var(--muted)]">Loading...</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">No pending appeals for this session.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((a) => (
            <li key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
              <p className="font-medium text-[var(--text)]">{a.member_name}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Submitted {new Date(a.submitted_at ?? a.created_at).toLocaleString()}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => review(a.id, "approve")}
                  disabled={busyId === a.id}
                  className="min-h-10 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-white disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => review(a.id, "reject")}
                  disabled={busyId === a.id}
                  className="min-h-10 rounded-lg border border-[var(--danger)] px-3 text-sm font-medium text-[var(--danger)] disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {msg ? <p className="mt-3 text-sm text-[var(--muted)]">{msg}</p> : null}
    </section>
  );
}
