"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPeso } from "@/lib/format-peso";

interface Structure {
  id: string;
  name: string;
  amount: number;
  deadline: string | null;
  installment_months: number | null;
  for_all: boolean;
  batch: string | null;
  is_active: boolean;
}

interface Batch {
  id: string;
  year: string;
}

export default function PaymentStructuresPage() {
  const [structures, setStructures] = useState<Structure[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [installmentMonths, setInstallmentMonths] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [forAll, setForAll] = useState(true);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editInstallment, setEditInstallment] = useState("");
  const [editForAll, setEditForAll] = useState(true);
  const [editBatch, setEditBatch] = useState("");

  const load = useCallback(async () => {
    const [sRes, bRes] = await Promise.all([
      fetch("/api/admin/payment-structures", { credentials: "same-origin" }),
      fetch("/api/admin/member-batches", { credentials: "same-origin" }),
    ]);
    if (sRes.ok) {
      const j = (await sRes.json()) as { structures: Structure[] };
      setStructures(j.structures ?? []);
    }
    if (bRes.ok) {
      const j = (await bRes.json()) as { batches: Batch[] };
      setBatches(j.batches ?? []);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        amount: parseFloat(amount),
        for_all: forAll,
        batch: forAll ? null : (selectedBatch || null),
      };
      if (deadline) body.deadline = deadline;
      if (installmentMonths) body.installment_months = parseInt(installmentMonths);
      const res = await fetch("/api/admin/payment-structures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setErr(j.error ?? "Could not add payment structure");
        return;
      }
      setName("");
      setAmount("");
      setDeadline("");
      setInstallmentMonths("");
      setForAll(true);
      setSelectedBatch("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    setErr(null);
    const body: Record<string, unknown> = {
      name: editName.trim(),
      amount: parseFloat(editAmount),
      for_all: editForAll,
      batch: editForAll ? null : (editBatch || null),
    };
    if (editDeadline) body.deadline = editDeadline;
    else body.deadline = null;
    if (editInstallment) body.installment_months = parseInt(editInstallment);
    else body.installment_months = null;
    const res = await fetch(`/api/admin/payment-structures/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      setErr(j.error ?? "Could not save");
      return;
    }
    setEditing(null);
    load();
  }

  async function deactivate(id: string) {
    await fetch(`/api/admin/payment-structures/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    load();
  }

  function startEdit(s: Structure) {
    setEditing(s.id);
    setEditName(s.name);
    setEditAmount(String(s.amount));
    setEditDeadline(s.deadline ?? "");
    setEditInstallment(s.installment_months ? String(s.installment_months) : "");
    setEditForAll(s.for_all);
    setEditBatch(s.batch ?? "");
  }

  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-lg font-semibold">Payment Structures</h1>

      <form onSubmit={add} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <h2 className="font-semibold text-sm">Add payment type</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Name</span>
            <input
              required
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sinking Fund"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Amount</span>
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="300"
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Deadline (optional)</span>
            <input
              type="date"
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Installment months (optional)</span>
            <input
              type="number"
              min="1"
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={installmentMonths}
              onChange={(e) => setInstallmentMonths(e.target.value)}
              placeholder="e.g. 12"
            />
          </label>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <button
              type="button"
              role="switch"
              aria-checked={forAll}
              onClick={() => { setForAll(!forAll); setSelectedBatch(""); }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${forAll ? "bg-[var(--accent)]" : "bg-gray-300"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${forAll ? "translate-x-5" : "translate-x-0"}`} />
            </button>
            <span className="text-[var(--muted)]">For all members</span>
          </label>
          {!forAll ? (
            <label className="block text-sm">
              <span className="text-[var(--muted)]">Batch (optional)</span>
              <select
                className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
                value={selectedBatch}
                onChange={(e) => setSelectedBatch(e.target.value)}
              >
                <option value="">Any batch</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.year}>{b.year}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {err ? <p className="text-sm text-[var(--danger)]">{err}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add payment type"}
        </button>
      </form>

      <div className="space-y-3">
        {structures.map((s) => (
          <div key={s.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            {editing === s.id ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-[var(--muted)]">Name</span>
                    <input
                      className="mt-1 w-full min-h-10 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-[var(--muted)]">Amount</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="mt-1 w-full min-h-10 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-[var(--muted)]">Deadline</span>
                    <input
                      type="date"
                      className="mt-1 w-full min-h-10 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2"
                      value={editDeadline}
                      onChange={(e) => setEditDeadline(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-[var(--muted)]">Installment months</span>
                    <input
                      type="number"
                      min="1"
                      className="mt-1 w-full min-h-10 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2"
                      value={editInstallment}
                      onChange={(e) => setEditInstallment(e.target.value)}
                    />
                  </label>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 text-sm">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={editForAll}
                      onClick={() => { setEditForAll(!editForAll); setEditBatch(""); }}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${editForAll ? "bg-[var(--accent)]" : "bg-gray-300"}`}
                    >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${editForAll ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                    <span className="text-[var(--muted)]">For all members</span>
                  </label>
                  {!editForAll ? (
                    <label className="block text-sm">
                      <span className="text-[var(--muted)]">Batch (optional)</span>
                      <select
                        className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
                        value={editBatch}
                        onChange={(e) => setEditBatch(e.target.value)}
                      >
                        <option value="">Any batch</option>
                        {batches.map((b) => (
                          <option key={b.id} value={b.year}>{b.year}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => saveEdit(s.id)}
                    className="min-h-9 rounded-lg bg-[var(--accent)] px-3 text-sm text-white"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="min-h-9 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {formatPeso(Number(s.amount))}
                    {s.installment_months ? ` / ${s.installment_months} months` : ""}
                    {s.deadline ? ` · Due: ${s.deadline}` : ""}
                    {s.for_all === false ? <span className="ml-2 text-xs text-[var(--accent)]">{s.batch ? `Batch ${s.batch}` : "Selected members"}</span> : <span className="ml-2 text-xs text-[var(--muted)]">All members</span>}
                    {!s.is_active ? <span className="ml-2 text-xs text-[var(--danger)]">Inactive</span> : null}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={`/api/admin/payment-structures/${s.id}/pdf`}
                    className="text-sm text-[var(--accent)]"
                  >
                    Report
                  </a>
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    className="text-sm text-[var(--accent)]"
                  >
                    Edit
                  </button>
                  {s.is_active ? (
                    <button
                      type="button"
                      onClick={() => deactivate(s.id)}
                      className="text-sm text-[var(--danger)]"
                    >
                      Deactivate
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ))}
        {structures.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--muted)]">No payment structures yet.</p>
        ) : null}
      </div>
    </div>
  );
}
