"use client";

/**
 * APL-4: what happened to my appeal.
 *
 * This is the reason module 05 stops deleting resolved appeals. A member who appealed and
 * then saw nothing change had no way to tell "declined" from "ignored", so they appealed
 * again, or gave up. Every decided appeal is shown with its outcome and, when it was
 * turned down, the reason the reviewer gave.
 *
 * Pending is shown as plainly as decided. "Still waiting" is the honest answer and it is
 * more useful than a row that silently disappears.
 */

export type MyAppeal = {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  resolution: string | null;
  reject_reason: string | null;
  reviewed_at: string | null;
  submitted_at: string;
  note: string | null;
};

const STATUS_COPY: Record<MyAppeal["status"], { label: string; detail: string }> = {
  pending: {
    label: "Waiting",
    detail: "Your appeal has been received and is still being reviewed. Attendance for this month cannot change until the report is closed.",
  },
  approved: {
    label: "Approved",
    detail: "Your attendance was added to this Mass.",
  },
  rejected: {
    label: "Not approved",
    detail: "This appeal was turned down.",
  },
  expired: {
    label: "Closed",
    detail: "The month was closed before this appeal was reviewed, so it could no longer be applied.",
  },
};

export function MyAppealsList({ appeals }: { appeals: MyAppeal[] }) {
  if (appeals.length === 0) return null;

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--brand)]">My appeals</h2>
      <ul className="mt-3 space-y-2">
        {appeals.map((a) => {
          const copy = STATUS_COPY[a.status] ?? STATUS_COPY.pending;
          const decided = a.status !== "pending";

          return (
            <li
              key={a.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-[var(--text)]">{copy.label}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {decided && a.reviewed_at
                    ? new Date(a.reviewed_at).toLocaleString()
                    : `Sent ${new Date(a.submitted_at).toLocaleString()}`}
                </p>
              </div>

              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{copy.detail}</p>

              {a.reject_reason ? (
                <p className="mt-2 rounded-lg bg-[var(--surface)] p-2 text-xs text-[var(--text)]">
                  <span className="text-[var(--text-muted)]">Reason: </span>
                  {a.reject_reason}
                </p>
              ) : null}

              {a.note ? (
                <p className="mt-2 text-xs italic text-[var(--text-muted)]">You wrote: “{a.note}”</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
