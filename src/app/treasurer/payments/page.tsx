"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PaymentLookup from "@/components/PaymentLookup";
import ReceiptModal from "@/components/ReceiptModal";
import ConfirmModal from "@/components/ConfirmModal";
import { formatPeso } from "@/lib/format-peso";

interface Member {
  id: string;
  full_name: string;
}

interface Structure {
  id: string;
  name: string;
  amount: number;
  for_all: boolean;
  batch: string | null;
  is_active: boolean;
}

interface Payment {
  id: string;
  amount_paid: number;
  paid_at: string;
  notes?: string | null;
  voided?: boolean;
  members: { full_name: string } | null;
  payment_structures: { name: string; amount: number } | null;
}

export default function PaymentsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [structures, setStructures] = useState<Structure[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedStructure, setSelectedStructure] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    memberName: string;
    structureName: string;
    amountPaid: number;
    date: string;
    receiptId: string;
  } | null>(null);

  const load = useCallback(async () => {
    const [mRes, sRes] = await Promise.all([
      fetch("/api/admin/members?all=1", { credentials: "same-origin" }),
      fetch("/api/admin/payment-structures", { credentials: "same-origin" }),
    ]);
    if (mRes.ok) {
      const mj = (await mRes.json()) as { members: Member[] };
      setMembers(mj.members ?? []);
    }
    if (sRes.ok) {
      const sj = (await sRes.json()) as { structures: Structure[] };
      setStructures((sj.structures ?? []).filter((s) => s.is_active !== false));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function voidPayment(id: string) {
    setVoiding(id);
    try {
      const res = await fetch(`/api/admin/payments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        alert(j.error ?? "Could not void payment");
        return;
      }
      setAllPayments((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setVoiding(null);
      setConfirmVoid(null);
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/payments?include_voided=1", { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as { payments: Payment[] };
      setAllPayments(j.payments ?? []);
    })();
  }, []);

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return members.filter((m) => m.full_name.toLowerCase().includes(q));
  }, [search, members]);

  useEffect(() => {
    if (!selectedMember || !selectedStructure) {
      setPayments([]);
      return;
    }
    (async () => {
      const res = await fetch(
        `/api/admin/payments?member_id=${selectedMember.id}&structure_id=${selectedStructure}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return;
      const j = (await res.json()) as { payments: Payment[] };
      setPayments(j.payments ?? []);
    })();
  }, [selectedMember, selectedStructure]);

  const structure = useMemo(
    () => structures.find((s) => s.id === selectedStructure),
    [structures, selectedStructure]
  );

  const totalPaid = useMemo(
    () => payments.reduce((sum, p) => sum + Number(p.amount_paid), 0),
    [payments]
  );

  const totalAmount = structure ? Number(structure.amount) : 0;
  const remaining = totalAmount - totalPaid;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMember || !selectedStructure) return;
    setErr(null);
    setSuccess(false);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        member_id: selectedMember.id,
        payment_structure_id: selectedStructure,
        amount_paid: parseFloat(amountPaid),
      };
      if (paidAt) body.paid_at = paidAt;
      if (notes.trim()) body.notes = notes.trim();
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setErr(j.error ?? "Could not record payment");
        return;
      }
      const j = (await res.json()) as { id: string };
      setSuccess(true);
      setReceipt({
        memberName: selectedMember!.full_name,
        structureName: structure?.name ?? "",
        amountPaid: parseFloat(amountPaid),
        date: paidAt || new Date().toISOString().split("T")[0],
        receiptId: j.id,
      });
      setAmountPaid("");
      setPaidAt("");
      setNotes("");
      const refreshRes = await fetch("/api/admin/payments?include_voided=1", { credentials: "same-origin" });
      if (refreshRes.ok) {
        const rj = (await refreshRes.json()) as { payments: Payment[] };
        setAllPayments(rj.payments ?? []);
      }
    } finally {
      setBusy(false);
    }
  }

  const [allPayments, setAllPayments] = useState<Payment[]>([]);
  const [tab, setTab] = useState<"record" | "lookup">("record");

  return (
    <div className="space-y-6 pb-8">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("record")}
          className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${tab === "record" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}
        >
          Record
        </button>
        <button
          type="button"
          onClick={() => setTab("lookup")}
          className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${tab === "lookup" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}
        >
          Lookup
        </button>
      </div>

      {tab === "record" ? (
        <>
          <h1 className="text-lg font-semibold">Record Payment</h1>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <div>
          <label htmlFor="member-search" className="text-sm font-medium text-[var(--muted)]">Member</label>
          <input
            id="member-search"
            type="search"
            className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
            placeholder="Search by name"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedMember(null); }}
            autoComplete="off"
          />
          {selectedMember ? (
            <p className="mt-1 text-sm font-medium text-[var(--accent)]">{selectedMember.full_name}</p>
          ) : search.trim() && filteredMembers.length > 0 ? (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
              {filteredMembers.slice(0, 10).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface)]"
                    onClick={() => { setSelectedMember(m); setSearch(m.full_name); }}
                  >
                    {m.full_name}
                  </button>
                </li>
              ))}
            </ul>
          ) : search.trim() && filteredMembers.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--muted)]">No members found.</p>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-[var(--muted)]">Payment type</span>
            <select
              required
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={selectedStructure}
              onChange={(e) => setSelectedStructure(e.target.value)}
            >
              <option value="">Select payment type</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatPeso(Number(s.amount))}
                  {s.for_all === false ? (s.batch ? ` (Batch ${s.batch})` : " (Selected)") : ""}
                </option>
              ))}
            </select>
          </label>

          {structure ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-1 text-sm">
              <p>Total amount: <strong>{formatPeso(totalAmount)}</strong></p>
              <p>Total paid: <strong>{formatPeso(totalPaid)}</strong></p>
              <p>Remaining balance: <strong className={remaining <= 0 ? "text-green-600" : ""}>{formatPeso(Math.max(0, remaining))}</strong></p>
            </div>
          ) : null}

          <label className="block text-sm">
            <span className="font-medium text-[var(--muted)]">Amount to pay now</span>
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="0.00"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-[var(--muted)]">Date paid (optional)</span>
              <input
                type="date"
                className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-[var(--muted)]">Notes (optional)</span>
              <input
                className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </label>
          </div>

          {err ? <p className="text-sm text-[var(--danger)]">{err}</p> : null}
          {success ? <p className="text-sm text-green-600">Payment recorded!</p> : null}

          <button
            type="submit"
            disabled={busy || !selectedMember || !selectedStructure}
            className="min-h-12 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Recording…" : "Record payment"}
          </button>
        </form>
      </div>

      {selectedMember && selectedStructure ? (
        <div>
          <h2 className="font-semibold mb-2">Payment history for {selectedMember.full_name}</h2>
          <div className="space-y-2">
            {payments.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No payments recorded yet.</p>
            ) : (
              payments.map((p) => (
                <div key={p.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                  <span className="font-medium">{formatPeso(Number(p.amount_paid))}</span>
                  <span className="text-[var(--muted)]"> on {p.paid_at}</span>
                  {p.notes ? <span className="text-[var(--muted)]"> — {p.notes}</span> : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div>
        <h2 className="font-semibold mb-2">All recorded payments</h2>
        {allPayments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">No payments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {allPayments.map((p) => (
              <div key={p.id} className={`rounded-2xl border p-4 text-sm ${p.voided ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950" : "border-[var(--border)] bg-[var(--surface)]"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{p.members?.full_name ?? "Unknown"}</p>
                    <p className="text-[var(--muted)]">{p.payment_structures?.name ?? "Unknown"} — {formatPeso(Number(p.amount_paid))}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.voided ? (
                      <span className="rounded bg-[var(--danger)] px-2 py-0.5 text-xs font-semibold text-white">VOIDED</span>
                    ) : (
                      <>
                        <span className="text-xs text-[var(--muted)]">{p.paid_at}</span>
                        <button
                          type="button"
                          onClick={() => setConfirmVoid(p.id)}
                          className="min-h-8 rounded-lg border border-[var(--danger)] px-3 text-xs font-medium text-[var(--danger)]"
                        >
                          Void
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {p.notes ? <p className="mt-1 text-xs text-[var(--muted)]">Note: {p.notes}</p> : null}
                {p.voided ? <p className="mt-1 text-xs text-[var(--muted)]">{p.paid_at}</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold">Payment Lookup</h1>
          <PaymentLookup />
        </>
      )}

      {confirmVoid ? (
        <ConfirmModal
          message="Are you sure you want to void this payment? This will remove it from the member's payment history."
          confirmLabel="Yes, void payment"
          busy={voiding === confirmVoid}
          onConfirm={() => voidPayment(confirmVoid)}
          onCancel={() => setConfirmVoid(null)}
        />
      ) : null}
      {receipt ? (
        <ReceiptModal data={receipt} onClose={() => { setReceipt(null); setSuccess(false); }} />
      ) : null}
    </div>
  );
}
