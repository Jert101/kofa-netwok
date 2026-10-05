"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import ReceiptModal from "@/components/ReceiptModal";
import { formatPeso } from "@/lib/format-peso";
import { churchTodayLabel } from "@/lib/time/church-time-labels";
import { messageOf, readEnvelope } from "@/lib/api/client";

type Receipt = {
  id: string;
  control_no: string;
  has_control_no: boolean;
  amount_paid: number;
  paid_at: string | null;
  notes: string | null;
  voided: boolean;
  void_reason: string | null;
  structure_name: string;
};

/**
 * The member's own receipts, newest first.
 *
 * A member who paid at the desk gets handed a slip that the officer then photographs and sends on.
 * This is the same paperwork from the member's side, with the control number on it, so a payment can be
 * traced either way -- the member quoting KOA-2026-00042 and the treasurer finding that exact row.
 *
 * The data comes from `/api/member/receipts`, which can only answer for the signed-in member.
 */
export default function MemberReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Receipt | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/member/receipts", { credentials: "same-origin", cache: "no-store" });
      const env = await readEnvelope<{ receipts: Receipt[] }>(res);
      if (!res.ok || !env || !env.ok) {
        setError(messageOf(env, "Could not load your receipts."));
        setReceipts(null);
        return;
      }
      setReceipts(env.data.receipts ?? []);
    } catch {
      setError("Could not load your receipts.");
      setReceipts(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 pb-10">
      <header>
        <h1 className="text-lg font-semibold sm:text-xl">My receipts</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Every payment you have made, with the control number to quote if you need it traced.
        </p>
      </header>

      {error ? (
        <div role="alert" className="rounded-2xl border border-[var(--danger)] p-4 text-sm text-[var(--danger)]">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 font-medium underline">
            Try again
          </button>
        </div>
      ) : null}

      {loading && receipts === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : null}

      {!loading && receipts !== null && receipts.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
          You have no receipts yet.
        </p>
      ) : null}

      {receipts && receipts.length > 0 ? (
        <ul className="space-y-2">
          {receipts.map((r) => (
            <li key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{r.structure_name}</span>
                <span className="font-semibold tabular-nums">{formatPeso(r.amount_paid)}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {r.paid_at ? churchTodayLabel(r.paid_at) : "No date"}
                {" · "}
                <span className="font-mono text-xs">Control {r.control_no}</span>
              </p>
              {r.notes ? <p className="mt-1 text-sm text-[var(--text-muted)]">{r.notes}</p> : null}
              {r.voided ? (
                <p className="mt-2 text-sm text-[var(--danger)]">
                  This payment was voided{r.void_reason ? `: ${r.void_reason}` : ""}.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(r)}
                className="mt-3 min-h-11 w-full rounded-xl border border-[var(--border)] text-sm font-medium sm:w-auto sm:px-4"
              >
                View / download receipt
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-[var(--text-muted)]">
        Missing a payment? <Link href="/member/payments" className="underline">Check your balance</Link> or
        ask the treasurer to quote your control number.
      </p>

      {open ? (
        <ReceiptModal
          data={{
            memberName: "Your payment",
            structureName: open.structure_name,
            amountPaid: open.amount_paid,
            date: open.paid_at ?? "",
            controlNo: open.control_no,
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}