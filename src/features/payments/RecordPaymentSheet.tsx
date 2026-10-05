"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPeso } from "@/lib/format-peso";
import { VOID_REASONS, validateVoidReason } from "@/lib/payments/rules";
import { churchTodayLabel } from "@/lib/time/church-time-labels";

export type RecordDefaults = {
  as_of: string;
  structure_name: string;
  amount: number;
  paid: number;
  remaining: number;
  credit: number;
  paid_up: boolean;
  due_to_date: number;
  still_due: number;
  suggested_amount: number;
  next_installment: { month: string; amount: number; paid: number } | null;
};

export type MemberOption = {
  id: string;
  full_name: string;
  batch: string | null;
  is_active: boolean;
  /** What this person still owes on the chosen structure. Null until a structure is chosen. */
  still_due: number | null;
  note?: string | null;
};

export type StructureOption = {
  id: string;
  name: string;
  amount: number;
  for_all: boolean;
  batch: string | null;
  is_active: boolean;
  /** True when any non-voided payment exists, which locks the money fields. */
  hasPayments: boolean;
};

export type RecordPaymentSheetProps = {
  structures: StructureOption[];
  members: MemberOption[];
  today: string;
  onRecorded?: (result: {
    id: string;
    /** The sequential control number assigned by the database, e.g. KOA-2026-00042. */
    controlNo: string;
    memberName: string;
    structureName: string;
    amount: number;
    date: string;
  }) => void;
};

/**
 * PAY-2: the record sheet.
 *
 * Four steps in one view, and the ordering is the point: structure, then member, then amount, then date.
 * The amount cannot be defaulted before a member is chosen, because what somebody owes is a fact about
 * that person on that structure, not about the structure.
 *
 * Two behaviours here exist because of the module's own problems:
 *
 * - The amount defaults to what is *still owed*, not the full amount (P1: double entries). A fully paid
 *   structure opens at zero rather than at the face value.
 * - A payment repeated inside ten minutes is caught before it is written (P1 again), and the treasurer
 *   confirms rather than the app refusing: two people paying the same dues with the same money on the
 *   same morning is genuinely possible.
 *
 * The structure stays selected after a save, because "Record another" is three payments in a row for
 * half the collection.
 */
export function RecordPaymentSheet({
  structures,
  members,
  today,
  onRecorded,
}: RecordPaymentSheetProps) {
  const activeStructures = useMemo(() => structures.filter((s) => s.is_active), [structures]);

  const [structureId, setStructureId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [notes, setNotes] = useState("");
  const [defaults, setDefaults] = useState<RecordDefaults | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const structure = activeStructures.find((s) => s.id === structureId) ?? null;
  const member = members.find((m) => m.id === memberId) ?? null;

  // Members the chosen structure actually applies to. A batch structure offering a member from another
  // batch invites a payment that the API will then refuse.
  const eligibleMembers = useMemo(() => {
    if (!structure) return members;
    if (structure.for_all) return members;
    return members.filter((m) => m.batch === structure.batch);
  }, [members, structure]);

  const loadDefaults = useCallback(async () => {
    if (!structureId || !memberId) {
      setDefaults(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/payments/suggest?member_id=${encodeURIComponent(memberId)}&structure_id=${encodeURIComponent(structureId)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { data?: RecordDefaults };
      if (!json.data) return;
      setDefaults(json.data);
      // Spec §PAY-2. Only when the field is untouched, so a treasurer who typed an amount and then
      // changed the member does not lose what they typed.
      setAmount((current) => (current === "" ? String(json.data!.suggested_amount) : current));
    } catch {
      // A missing hint is not a broken form. The treasurer can type an amount.
    }
  }, [memberId, structureId]);

  useEffect(() => {
    void loadDefaults();
  }, [loadDefaults]);

  // A change of structure or member invalidates the amount that was defaulted for the previous pair.
  function changeStructure(nextId: string) {
    setStructureId(nextId);
    setDefaults(null);
    setAmount("");
    setDuplicateWarning(null);
    setSaved(null);
  }

  function changeMember(nextId: string) {
    setMemberId(nextId);
    setDefaults(null);
    setAmount("");
    setDuplicateWarning(null);
    setSaved(null);
  }

  async function submit(confirmDuplicate: boolean) {
    setError(null);
    setSaved(null);

    if (!structure || !member) {
      setError("Choose a structure and a member.");
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount above zero.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/treasurer/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          member_id: member.id,
          payment_structure_id: structure.id,
          amount_paid: value,
          paid_at: paidAt,
          notes: notes.trim() || undefined,
          confirm_duplicate: confirmDuplicate,
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | {
            data?: { id: string; control_no?: string | null; still_due: number };
            error?: { message?: string; fields?: Record<string, string> };
          }
        | null;

      if (res.status === 409) {
        // The duplicate guard. Kept as a question rather than an error.
        setDuplicateWarning(json?.error?.message ?? "This looks like a duplicate. Record anyway?");
        return;
      }
      if (!res.ok) {
        setError(json?.error?.message ?? "Could not record that payment.");
        return;
      }

      const id = json?.data?.id ?? "";
      // The server assigns the control number in a BEFORE INSERT trigger and hands it back, so the
      // receipt can print the real number rather than a slice of the uuid. If it is somehow absent
      // (a payment recorded before the migration), fall back so the receipt still says something.
      const controlNo = json?.data?.control_no ?? `KOA-${id.slice(0, 8).toUpperCase()}`;
      onRecorded?.({
        id,
        controlNo,
        memberName: member.full_name,
        structureName: structure.name,
        amount: value,
        date: paidAt,
      });

      setDuplicateWarning(null);
      setSaved(`Recorded ${formatPeso(value)} for ${member.full_name}.`);
      // Member, amount and notes clear; structure and date stay, which is "Record another".
      setMemberId("");
      setAmount("");
      setNotes("");
      setDefaults(null);
      void loadDefaults();
    } catch {
      setError("Could not record that payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="record-payment-heading" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 id="record-payment-heading" className="text-sm font-semibold text-[var(--brand)]">
        Record a payment
      </h2>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Structure</span>
          <select
            className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            value={structureId}
            onChange={(e) => changeStructure(e.target.value)}
          >
            <option value="">Choose a structure…</option>
            {activeStructures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {formatPeso(s.amount)}
                {s.for_all ? "" : ` (${s.batch})`}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Member</span>
          <select
            className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            value={memberId}
            onChange={(e) => changeMember(e.target.value)}
            disabled={!structure}
          >
            <option value="">{structure ? "Choose a member…" : "Choose a structure first"}</option>
            {eligibleMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
                {m.batch ? ` (${m.batch})` : ""}
                {!m.is_active ? " — inactive" : ""}
              </option>
            ))}
          </select>
          {member?.is_active === false ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              This member is inactive. Recording is still allowed, for a payment made before they left.
            </p>
          ) : null}
        </label>
      </div>

      {defaults ? (
        <dl className="mt-4 grid gap-2 rounded-xl bg-[var(--surface-2)] p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-[var(--text-muted)]">Amount</dt>
            <dd className="font-medium">{formatPeso(defaults.amount)}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Paid so far</dt>
            <dd className="font-medium">{formatPeso(defaults.paid)}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Due to {churchTodayLabel(defaults.as_of)}</dt>
            <dd className="font-medium">{formatPeso(defaults.due_to_date)}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Still owed</dt>
            <dd className="font-medium">{formatPeso(defaults.still_due)}</dd>
          </div>
          {defaults.next_installment ? (
            <p className="text-xs text-[var(--text-muted)] sm:col-span-2 lg:col-span-4">
              Next installment: {defaults.next_installment.month} ·{" "}
              {formatPeso(defaults.next_installment.amount)}
              {defaults.next_installment.paid > 0
                ? ` (${formatPeso(defaults.next_installment.paid)} paid)`
                : ""}
            </p>
          ) : null}
          {defaults.credit > 0 ? (
            <p className="text-xs text-[var(--text-muted)] sm:col-span-2 lg:col-span-4">
              Credit on account: {formatPeso(defaults.credit)}
            </p>
          ) : null}
          {defaults.paid_up ? (
            <p className="text-xs text-[var(--text-muted)] sm:col-span-2 lg:col-span-4">
              This structure is paid up for this member. Recording another payment will show as a credit.
            </p>
          ) : null}
        </dl>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium">Amount</span>
          <input
            className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!member}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Date</span>
          <input
            className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            type="date"
            value={paidAt}
            max={today}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Notes (optional)</span>
          <input
            className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            placeholder="Cheque no., envelope…"
          />
        </label>
      </div>

      {duplicateWarning ? (
        <div role="alert" className="mt-4 rounded-xl border border-[var(--brand)] p-3">
          <p className="text-sm">{duplicateWarning}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(true)}
              className="min-h-11 rounded-xl bg-[var(--brand)] px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              Record anyway
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDuplicateWarning(null)}
              className="min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm font-medium disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">{saved}</p>
      ) : null}

      <button
        type="button"
        disabled={busy || !structure || !member}
        onClick={() => void submit(false)}
        className="mt-4 min-h-12 w-full rounded-xl bg-[var(--brand)] px-4 font-medium text-white disabled:opacity-40 sm:w-auto"
      >
        {busy ? "Recording…" : "Record payment"}
      </button>
    </section>
  );
}

/**
 * PAY-3: the void dialog.
 *
 * A reason is required and "Other" demands a note, because the reason is the only thing that will still
 * be here in two years to explain a missing peso. The old flow voided with an empty body.
 */
export function VoidPaymentDialog({
  memberName,
  structureName,
  amount,
  busy,
  onConfirm,
  onCancel,
}: {
  memberName: string;
  structureName: string;
  amount: number;
  busy: boolean;
  onConfirm: (reason: string, note: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const problem = validateVoidReason(reason, note);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="void-heading" className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--surface)] p-5">
        <h2 id="void-heading" className="text-base font-semibold">
          Void this payment
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {formatPeso(amount)} from {memberName} for {structureName}. The row stays in the list with your
          reason beside it, and stops counting towards any balance.
        </p>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Why</legend>
          <div className="mt-2 space-y-2">
            {VOID_REASONS.map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="void-reason"
                  className="size-5"
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                <span className="text-sm">{r}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 block">
          <span className="text-sm font-medium">
            {reason === "Other" ? "Note (required)" : "Note (optional)"}
          </span>
          <textarea
            className="mt-1 min-h-20 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={400}
          />
        </label>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || problem !== null}
            onClick={() => onConfirm(reason, note.trim())}
            className="min-h-12 rounded-xl bg-[var(--danger)] px-4 font-medium text-white disabled:opacity-40"
          >
            {busy ? "Voiding…" : "Void payment"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-12 rounded-xl border border-[var(--border)] px-4 font-medium disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}