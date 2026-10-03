"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  RecordPaymentSheet,
  VoidPaymentDialog,
  type MemberOption,
  type StructureOption,
} from "@/features/payments/RecordPaymentSheet";
import { LedgerView } from "@/features/payments/LedgerView";
import ReceiptModal from "@/components/ReceiptModal";
import { formatPeso } from "@/lib/format-peso";
import { churchTodayLabel, truncateName } from "@/lib/time/church-time-labels";

type PaymentRow = {
  id: string;
  amount_paid: number;
  paid_at: string | null;
  notes: string | null;
  voided: boolean;
  void_reason: string | null;
  void_note: string | null;
  voided_at: string | null;
  payment_structure_id: string;
  member_id: string;
  members: { full_name: string } | null;
  payment_structures: { name: string } | null;
};

type StructureRow = StructureOption & { id: string; name: string; amount: number };

export default function TreasurerPaymentsPage() {
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showVoided, setShowVoided] = useState(true);
  const [voidTarget, setVoidTarget] = useState<PaymentRow | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    memberName: string;
    structureName: string;
    amountPaid: number;
    date: string;
    receiptId: string;
  } | null>(null);
  const [ledgerMemberId, setLedgerMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [structureRes, memberRes, paymentRes] = await Promise.all([
        fetch("/api/admin/payment-structures?all=1", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/admin/members?all=1", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/admin/payments?include_voided=1", { credentials: "same-origin", cache: "no-store" }),
      ]);

      if (!structureRes.ok || !memberRes.ok || !paymentRes.ok) {
        setError("Could not load the payments pages.");
        return;
      }

      const [structureJson, memberJson, paymentJson] = await Promise.all([
        structureRes.json() as Promise<{ structures?: Array<Record<string, unknown>> }>,
        memberRes.json() as Promise<{ members?: Array<Record<string, unknown>> }>,
        paymentRes.json() as Promise<{ payments?: PaymentRow[] }>,
      ]);

      setStructures((structureJson.structures ?? []) as unknown as StructureRow[]);
      setMembers(
        (memberJson.members ?? []).map((m) => ({
          id: String(m.id),
          full_name: String(m.full_name ?? ""),
          batch: (m.batch as string | null) ?? null,
          is_active: m.is_active !== false,
          still_due: null,
        })),
      );
      setPayments(paymentJson.payments ?? []);

      // The church's date, from the same endpoint the record sheet's defaults use, so the date field
      // does not open on the server's idea of today.
      const tzRes = await fetch("/api/admin/settings", { credentials: "same-origin", cache: "no-store" });
      if (tzRes.ok) {
        const tzJson = (await tzRes.json()) as { data?: { report_timezone?: string } };
        const zone = tzJson.data?.report_timezone ?? "Asia/Manila";
        try {
          setToday(new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date()));
        } catch {
          setToday(new Date().toISOString().slice(0, 10));
        }
      }
    } catch {
      setError("Could not load the payments pages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visiblePayments = useMemo(
    () => (showVoided ? payments : payments.filter((p) => !p.voided)),
    [payments, showVoided],
  );

  async function confirmVoid(reason: string, note: string) {
    if (!voidTarget) return;
    setVoidBusy(true);
    try {
      const res = await fetch(`/api/treasurer/payments/${voidTarget.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ reason, note }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(json?.error?.message ?? "Could not void that payment.");
        return;
      }
      // Marked locally rather than refetched, so the row the treasurer just acted on does not jump
      // while they are still reading the dialog.
      setPayments((prev) =>
        prev.map((p) =>
          p.id === voidTarget.id
            ? { ...p, voided: true, void_reason: reason, void_note: note, voided_at: new Date().toISOString() }
            : p,
        ),
      );
      setVoidTarget(null);
    } finally {
      setVoidBusy(false);
    }
  }

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-lg font-semibold">Payments</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Record a payment, and check what anybody owes on their ledger. Today is{" "}
          {today ? churchTodayLabel(today) : "…"}.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : (
        <>
          <RecordPaymentSheet
            structures={structures}
            members={members}
            today={today}
            onRecorded={(result) => {
              setReceipt({
                memberName: result.memberName,
                structureName: result.structureName,
                amountPaid: result.amount,
                date: result.date,
                receiptId: result.id,
              });
              void load();
            }}
          />

          <section aria-labelledby="payments-list-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="payments-list-heading" className="text-sm font-semibold text-[var(--brand)]">
                All recorded payments
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={showVoided}
                    onChange={(e) => setShowVoided(e.target.checked)}
                  />
                  Show voided
                </label>
                <Link
                  href="/treasurer/payments/csv"
                  className="min-h-11 rounded-xl border border-[var(--border)] px-3 text-sm font-medium leading-[2.75rem]"
                >
                  Export CSV
                </Link>
              </div>
            </div>

            {visiblePayments.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--text-muted)]">No payments recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {visiblePayments.map((p) => {
                  const name = truncateName(p.members?.full_name ?? "Member");
                  return (
                    <li
                      key={p.id}
                      className={
                        "rounded-xl border border-[var(--border)] p-3 " +
                        (p.voided ? "bg-[var(--surface-2)] opacity-70" : "bg-[var(--surface)]")
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium" title={name.truncated ? name.text + "…" : undefined}>
                            {name.text}
                          </p>
                          <p className="text-sm text-[var(--text-muted)]">
                            {p.payment_structures?.name ?? "Unknown structure"}
                            {p.paid_at ? ` · ${churchTodayLabel(p.paid_at)}` : ""}
                          </p>
                          {p.notes ? <p className="mt-1 text-sm text-[var(--text-muted)]">{p.notes}</p> : null}
                          {p.voided ? (
                            <p className="mt-1 text-sm text-[var(--danger)]">
                              Voided{p.void_reason ? `: ${p.void_reason}` : ""}
                              {p.void_note ? ` — ${p.void_note}` : ""}
                              {p.voided_at ? ` (${churchTodayLabel(p.voided_at)})` : ""}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold">
                            {p.voided ? "" : formatPeso(p.amount_paid)}
                            {p.voided ? (
                              <span className="ml-2 text-xs uppercase tracking-wide text-[var(--danger)]">
                                voided
                              </span>
                            ) : null}
                          </span>
                          {!p.voided ? (
                            <button
                              type="button"
                              onClick={() => setVoidTarget(p)}
                              className="min-h-11 rounded-xl border border-[var(--border)] px-3 text-sm"
                            >
                              Void
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setLedgerMemberId(p.member_id)}
                            className="min-h-11 rounded-xl border border-[var(--border)] px-3 text-sm"
                          >
                            Ledger
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {voidTarget ? (
        <VoidPaymentDialog
          memberName={voidTarget.members?.full_name ?? "This member"}
          structureName={voidTarget.payment_structures?.name ?? "this structure"}
          amount={voidTarget.amount_paid}
          busy={voidBusy}
          onConfirm={(reason, note) => void confirmVoid(reason, note)}
          onCancel={() => setVoidTarget(null)}
        />
      ) : null}

      {receipt ? (
        <ReceiptModal data={receipt} onClose={() => setReceipt(null)} />
      ) : null}

      {ledgerMemberId ? (
        <LedgerView memberId={ledgerMemberId} onClose={() => setLedgerMemberId(null)} />
      ) : null}
    </div>
  );
}