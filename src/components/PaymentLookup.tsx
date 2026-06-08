"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPeso } from "@/lib/format-peso";

interface Member {
  id: string;
  full_name: string;
}

interface PaymentFull {
  id: string;
  amount_paid: number;
  paid_at: string;
  payment_structures: { name: string; amount: number } | null;
}

interface StructureLookup {
  id: string;
  name: string;
  amount: number;
}

export default function PaymentLookup() {
  const [members, setMembers] = useState<Member[]>([]);
  const [structures, setStructures] = useState<StructureLookup[]>([]);
  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [payments, setPayments] = useState<PaymentFull[]>([]);

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
      const sj = (await sRes.json()) as { structures: StructureLookup[] };
      setStructures(sj.structures ?? []);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredMembers = useMemo(() => {
    if (!search.trim() || selectedMember) return [];
    const q = search.toLowerCase();
    return members.filter((m) => m.full_name.toLowerCase().includes(q));
  }, [search, members, selectedMember]);

  useEffect(() => {
    if (!selectedMember) { setPayments([]); return; }
    (async () => {
      const res = await fetch(`/api/admin/payments?member_id=${selectedMember.id}`, { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as { payments: PaymentFull[] };
      setPayments(j.payments ?? []);
    })();
  }, [selectedMember]);

  const summaryByStructure = useMemo(() => {
    const map = new Map<string, { name: string; totalAmount: number; totalPaid: number }>();
    for (const p of payments) {
      const sid = p.payment_structures?.name ?? "unknown";
      const existing = map.get(sid) ?? { name: sid, totalAmount: 0, totalPaid: 0 };
      existing.totalPaid += Number(p.amount_paid);
      const st = p.payment_structures;
      if (st && st.amount > existing.totalAmount) existing.totalAmount = Number(st.amount);
      map.set(sid, existing);
    }
    for (const s of structures) {
      if (!map.has(s.name)) {
        map.set(s.name, { name: s.name, totalAmount: Number(s.amount), totalPaid: 0 });
      }
    }
    return Array.from(map.values()).filter((s) => s.totalAmount > 0);
  }, [payments, structures]);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="lookup-search" className="text-sm font-medium text-[var(--muted)]">Search member</label>
        <input
          id="lookup-search"
          type="search"
          className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
          placeholder="Type a name…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedMember(null); }}
          autoComplete="off"
        />
        {selectedMember ? (
          <p className="mt-1 text-sm font-medium text-[var(--accent)]">{selectedMember.full_name}</p>
        ) : null}
        {!selectedMember && search.trim() && filteredMembers.length > 0 ? (
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
        ) : null}
      </div>

      {selectedMember ? (
        summaryByStructure.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No payment structures found for this member.</p>
        ) : (
          <div className="space-y-3">
            {summaryByStructure.map((s) => {
              const remaining = s.totalAmount - s.totalPaid;
              return (
                <div key={s.name} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="font-medium">{s.name}</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p>Total amount: <strong>{formatPeso(s.totalAmount)}</strong></p>
                    <p>Total paid: <strong>{formatPeso(s.totalPaid)}</strong></p>
                    <p>
                      Remaining balance:{" "}
                      <strong className={remaining <= 0 ? "text-green-600" : ""}>
                        {formatPeso(Math.max(0, remaining))}
                      </strong>
                    </p>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[var(--muted)]">View payment history</summary>
                    <ul className="mt-2 space-y-1">
                      {payments
                        .filter((p) => p.payment_structures?.name === s.name)
                        .map((p) => (
                          <li key={p.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
                            <span className="font-medium">{formatPeso(Number(p.amount_paid))}</span>
                            <span className="text-[var(--muted)]"> on {p.paid_at}</span>
                          </li>
                        ))}
                    </ul>
                  </details>
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}
