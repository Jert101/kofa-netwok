"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppealRejectDialog } from "@/features/appeals/ui/AppealRejectDialog";
import { dataOf, messageOf, readEnvelope } from "@/lib/api/client";

type AppealItem = {
  id: string;
  member_id: string;
  member_name: string;
  status: string;
  resolution: string | null;
  reject_reason: string | null;
  reviewed_at: string | null;
  reviewed_by_role: string | null;
  created_at: string;
  submitted_at: string | null;
  note: string | null;
};

const STATUS_TABS = ["pending", "approved", "rejected", "expired"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

/**
 * APL-2 and APL-3: appeals for one session.
 *
 * The old version said "resolved appeals are removed" and did exactly that. Now the
 * resolved rows stay, under a tab, because the secretary's next question after approving
 * is usually "who decided that, and when".
 *
 * Approve-selected sends only the ticked ids through the atomic function, so a partial
 * approval is a real outcome rather than an error.
 */
export function AttendanceAppealsReview({
  sessionId,
  sessionLinkHref,
  onAppealApproved,
}: {
  sessionId: string;
  /** Optional link to the calendar for this session's date (APL-2). */
  sessionLinkHref?: string;
  /** Called after a successful approve so attendance UIs can reload from the server. */
  onAppealApproved?: () => void;
}) {
  const [tab, setTab] = useState<StatusTab>("pending");
  const [items, setItems] = useState<AppealItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AppealItem | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/attendance/session/${sessionId}/appeals?status=${tab}`, {
      credentials: "same-origin",
    });
    if (!res.ok) {
      setItems([]);
      return;
    }
    const env = await readEnvelope<{ appeals?: AppealItem[] }>(res);
    // Enveloped: the list is under `data`. Read flat it was always empty, so the per-session appeals
    // tab showed nothing at all.
    setItems(dataOf(env)?.appeals ?? []);
    // Selections are per-tab; carrying them across would approve rows that are no longer
    // on screen.
    setSelected(new Set());
  }, [sessionId, tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, action: "approve" | "reject", reason?: string, note?: string) {
    setMsg(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/attendance/appeals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, reason, note }),
      });
      const env = await readEnvelope<{
        approved?: number;
        merged_duplicates?: number;
        already_resolved?: number;
        rejected?: number;
      }>(res);
      if (!res.ok) {
        setMsg(messageOf(env, "Could not review appeal"));
        return;
      }

      const j = dataOf(env) ?? {};
      if (action === "approve") {
        // Two numbers, not one: the merged count is the part a reviewer wants to know,
        // because it means the member was already on the attendance list.
        setMsg(
          `Appeal approved${
            (j.merged_duplicates ?? 0) > 0 ? `, ${j.merged_duplicates} already on the list` : ""
          }.`,
        );
        // Enveloped: `approved` is under `data`. Read flat it was undefined, so this never fired and
        // the attendance list below did not refresh after an appeal was approved -- the reviewer saw
        // "approved" while the roster still showed the member as absent.
        if ((j.approved ?? 0) > 0) onAppealApproved?.();
      } else {
        setMsg("Appeal rejected. The member can see the reason.");
      }
      load();
    } finally {
      setBusyId(null);
      setRejectTarget(null);
    }
  }

  async function approveSelected() {
    setMsg(null);
    setApproveBusy(true);
    try {
      const res = await fetch("/api/attendance/appeals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ session_id: sessionId, item_ids: [...selected] }),
      });
      const env = await readEnvelope<{
        approved_count?: number;
        merged_duplicates?: number;
      }>(res);
      if (!res.ok) {
        setMsg(messageOf(env, "Could not approve selected appeals"));
        return;
      }
      const j = dataOf(env) ?? {};
      setMsg(
        `${j.approved_count ?? 0} approved${
          (j.merged_duplicates ?? 0) > 0 ? `, ${j.merged_duplicates} already on the list` : ""
        }.`,
      );
      onAppealApproved?.();
      load();
    } finally {
      setApproveBusy(false);
    }
  }

  async function approveAll() {
    setMsg(null);
    setApproveBusy(true);
    try {
      const res = await fetch(`/api/attendance/session/${sessionId}/appeals/approve-all`, {
        method: "POST",
        credentials: "same-origin",
      });
      const env = await readEnvelope<{ approved_count?: number }>(res);
      if (!res.ok) {
        setMsg(messageOf(env, "Could not approve all"));
        return;
      }
      const j = dataOf(env) ?? {};
      setMsg(`All ${j.approved_count ?? 0} pending appeals approved.`);
      onAppealApproved?.();
      load();
    } finally {
      setApproveBusy(false);
    }
  }

  const pending = items ?? [];
  const canBulk = tab === "pending" && pending.length > 0;

  return (
    <section className="relative mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {approveBusy ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/40 backdrop-blur-[2px]">
          <div className="rounded-xl bg-[var(--surface)] px-6 py-4 shadow-lg">
            <p className="text-sm font-semibold text-[var(--text)]">Saving approved attendances…</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--brand)]">Attendance appeals</h2>
        {sessionLinkHref ? (
          <Link
            href={sessionLinkHref}
            className="text-xs font-medium text-[var(--brand)] underline underline-offset-2"
          >
            View this Mass
          </Link>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Appeals by status">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={
              "min-h-9 rounded-lg px-3 text-xs font-medium capitalize " +
              (tab === s
                ? "bg-[var(--brand)] text-white"
                : "border border-[var(--border)] text-[var(--text-muted)]")
            }
          >
            {s}
          </button>
        ))}
      </div>

      {items === null ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          {tab === "pending" ? "No pending appeals for this Mass." : `No ${tab} appeals for this Mass.`}
        </p>
      ) : (
        <>
          {canBulk ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void approveAll()}
                disabled={approveBusy}
                className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-40"
              >
                Approve all ({pending.length})
              </button>
              <button
                type="button"
                onClick={() => void approveSelected()}
                disabled={approveBusy || selected.size === 0}
                className="min-h-10 rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                Approve selected ({selected.size})
              </button>
            </div>
          ) : null}

          <ul className="mt-3 space-y-2">
            {items.map((a) => (
              <li key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-start gap-3">
                  {tab === "pending" ? (
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                      checked={selected.has(a.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(a.id);
                          else n.delete(a.id);
                          return n;
                        })
                      }
                      aria-label={`Select ${a.member_name}`}
                    />
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--text)]">{a.member_name}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Submitted {new Date(a.submitted_at ?? a.created_at).toLocaleString()}
                    </p>

                    {a.note ? (
                      <p className="mt-2 rounded-lg bg-[var(--surface)] p-2 text-xs italic text-[var(--text-muted)]">
                        “{a.note}”
                      </p>
                    ) : null}

                    {tab !== "pending" ? (
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        {a.status === "approved"
                          ? "Approved"
                          : a.status === "expired"
                            ? "Expired automatically"
                            : "Rejected"}
                        {a.reviewed_at ? ` ${new Date(a.reviewed_at).toLocaleString()}` : ""}
                        {a.reviewed_by_role ? ` by ${a.reviewed_by_role}` : ""}
                        {a.reject_reason ? ` — ${a.reject_reason}` : ""}
                      </p>
                    ) : null}

                    {tab === "pending" ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void review(a.id, "approve")}
                          disabled={busyId === a.id || approveBusy}
                          className="min-h-10 rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectTarget(a)}
                          disabled={busyId === a.id || approveBusy}
                          className="min-h-10 rounded-lg border border-[var(--danger)] px-3 text-sm font-medium text-[var(--danger)] disabled:opacity-40"
                        >
                          Reject…
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AppealRejectDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
        memberName={rejectTarget?.member_name}
        busy={busyId === rejectTarget?.id}
        onConfirm={(reason, note) => {
          if (rejectTarget) void review(rejectTarget.id, "reject", reason, note);
        }}
      />

      {msg ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]" role="status">
          {msg}
        </p>
      ) : null}
    </section>
  );
}
