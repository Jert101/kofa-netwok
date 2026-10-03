"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPeso } from "@/lib/format-peso";
import {
  churchTodayLabel,
  installmentStatusClass,
  installmentStatusLabel,
} from "@/lib/time/church-time-labels";

type Installment = {
  index: number;
  month: string;
  dueOn: string;
  amount: number;
  paid: number;
  status: "paid" | "partly_paid" | "due" | "overdue";
};

type Block = {
  structureId: string;
  structureName: string;
  isActive: boolean;
  forAll: boolean;
  batch: string | null;
  deadline: string | null;
  installmentMonths: number | null;
  amount: number;
  paid: number;
  remaining: number;
  credit: number;
  paidUp: boolean;
  dueToDate: number;
  outstanding: number;
  installments: Installment[];
  unallocated: number;
  outOfScope: boolean;
};

type Ledger = {
  memberId: string;
  fullName: string;
  batch: string | null;
  isActive: boolean;
  asOf: string;
  blocks: Block[];
  payments: Array<{
    id: string;
    amountPaid: number;
    paidAt: string | null;
    notes: string | null;
    voided: boolean;
    voidReason: string | null;
    voidNote: string | null;
    voidedAt: string | null;
    structureName: string;
  }>;
  totals: { outstanding: number; credit: number; paidToDate: number };
};

/**
 * PAY-4: one member's whole position.
 *
 * A sheet rather than a page, because it is opened *from* something else — a payment row, the overdue
 * list, a search result — and the person who opened it still needs to see where they were.
 *
 * The numbers here come from the same `proration` functions as the record sheet and the overdue list,
 * which is the only reason the ledger and the status PDF agree.
 */
export function LedgerView({
  memberId,
  onClose,
}: {
  memberId: string;
  onClose?: () => void;
}) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [showVoided, setShowVoided] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/treasurer/members/${encodeURIComponent(memberId)}/ledger`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Could not load this ledger.");
        return;
      }
      const json = (await res.json()) as { data?: { ledger?: Ledger } };
      setLedger(json.data?.ledger ?? null);
    } catch {
      setError("Could not load this ledger.");
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const payments = (ledger?.payments ?? []).filter((p) => showVoided || !p.voided);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ledger-heading"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"
    >
      <div className="mx-auto w-full max-w-3xl rounded-2xl bg-[var(--surface)] p-5">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading the ledger…</p>
        ) : error || !ledger ? (
          <div>
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error ?? "No ledger for this member."}
            </p>
            {onClose ? (
              <button type="button" onClick={onClose} className="mt-4 min-h-11 rounded-xl border border-[var(--border)] px-4">
                Close
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="ledger-heading" className="text-base font-semibold">
                  {ledger.fullName}
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {ledger.batch ? `Batch ${ledger.batch} · ` : ""}
                  {ledger.isActive ? "Active" : "Inactive"} · as of {churchTodayLabel(ledger.asOf)}
                </p>
              </div>
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm"
                >
                  Close
                </button>
              ) : null}
            </div>

            <dl className="mt-4 grid gap-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[var(--text-muted)]">Outstanding</dt>
                <dd className="text-lg font-semibold">{formatPeso(ledger.totals.outstanding)}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Paid to date</dt>
                <dd className="text-lg font-semibold">{formatPeso(ledger.totals.paidToDate)}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Credit</dt>
                <dd className="text-lg font-semibold">
                  {ledger.totals.credit > 0 ? formatPeso(ledger.totals.credit) : "—"}
                </dd>
              </div>
            </dl>

            <div className="mt-5 space-y-4">
              {ledger.blocks.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No payment structures apply to this member.
                </p>
              ) : null}

              {ledger.blocks.map((block) => (
                <section key={block.structureId} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-medium">
                      {block.structureName}
                      {!block.isActive ? (
                        <span className="ml-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                          inactive
                        </span>
                      ) : null}
                      {!block.forAll ? (
                        <span className="ml-2 text-xs text-[var(--text-muted)]">batch {block.batch}</span>
                      ) : null}
                    </h3>
                    <p className="text-sm">
                      <span className="font-semibold">{formatPeso(block.amount)}</span>
                      <span className="text-[var(--text-muted)]"> due</span>
                    </p>
                  </div>

                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-[var(--text-muted)]">Paid</dt>
                      <dd>{formatPeso(block.paid)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--text-muted)]">Due to date</dt>
                      <dd>{formatPeso(block.dueToDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--text-muted)]">Outstanding</dt>
                      <dd className="font-medium">{formatPeso(block.outstanding)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--text-muted)]">Status</dt>
                      <dd className={block.paidUp ? "text-[var(--success)]" : undefined}>
                        {block.paidUp ? "Paid up" : "Not paid up"}
                      </dd>
                    </div>
                  </dl>

                  {block.outOfScope ? (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      This structure is scoped to batch {block.batch}, which this member is no longer in.
                      It is shown for history and does not count towards their outstanding total.
                    </p>
                  ) : null}

                  {block.installments.length > 0 ? (
                    <table className="mt-3 w-full text-left text-sm">
                      <caption className="sr-only">
                        Installment schedule for {block.structureName}
                      </caption>
                      <thead>
                        <tr className="text-[var(--text-muted)]">
                          <th scope="col" className="py-1 pr-2 font-medium">
                            Installment
                          </th>
                          <th scope="col" className="py-1 pr-2 font-medium">
                            Amount
                          </th>
                          <th scope="col" className="py-1 pr-2 font-medium">
                            Paid
                          </th>
                          <th scope="col" className="py-1 font-medium">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.installments.map((inst) => (
                          <tr key={inst.index} className="border-t border-[var(--border)]">
                            <th scope="row" className="py-1 pr-2 font-normal">
                              {inst.month}
                              <span className="block text-xs text-[var(--text-muted)]">
                                due {inst.dueOn}
                              </span>
                            </th>
                            <td className="py-1 pr-2">{formatPeso(inst.amount)}</td>
                            <td className="py-1 pr-2">{formatPeso(inst.paid)}</td>
                            <td className={`py-1 ${installmentStatusClass(inst.status)}`}>
                              {installmentStatusLabel(inst.status)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}

                  {block.unallocated > 0 ? (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {formatPeso(block.unallocated)} of payments do not fit any installment. They are
                      counted in &ldquo;paid&rdquo; above.
                    </p>
                  ) : null}
                </section>
              ))}
            </div>

            <section className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--brand)]">Payments</h3>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={showVoided}
                    onChange={(e) => setShowVoided(e.target.checked)}
                  />
                  Show voided
                </label>
              </div>

              {payments.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">No payments recorded.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {payments.map((p) => (
                    <li
                      key={p.id}
                      className={
                        "rounded-xl border border-[var(--border)] p-2 text-sm " +
                        (p.voided ? "bg-[var(--surface-2)] opacity-70" : "")
                      }
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>{p.structureName}</span>
                        <span className="font-medium">{formatPeso(p.amountPaid)}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">
                        {p.paidAt ? churchTodayLabel(p.paidAt) : "No date"}
                        {p.notes ? ` · ${p.notes}` : ""}
                      </p>
                      {p.voided ? (
                        <p className="mt-1 text-xs text-[var(--danger)]">
                          Voided{p.voidReason ? `: ${p.voidReason}` : ""}
                          {p.voidNote ? ` — ${p.voidNote}` : ""}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}