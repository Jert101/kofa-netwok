"use client";

import { useCallback, useEffect, useState } from "react";

type PinRole = "admin" | "secretary" | "member" | "officer" | "treasurer";

function SinglePinForm({ role, label }: { role: PinRole; label: string }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ role, pin, confirm }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not update PIN");
        return;
      }
      setMsg(`${label} PIN updated. Anyone using the old PIN must sign in again.`);
      setPin("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 space-y-2">
      <h3 className="text-sm font-medium text-[var(--text)]">{label}</h3>
      <input
        type="password"
        inputMode="numeric"
        className="w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
        placeholder="New PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        autoComplete="new-password"
      />
      <input
        type="password"
        inputMode="numeric"
        className="w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
        placeholder="Confirm new PIN"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
      />
      <button
        type="submit"
        disabled={busy || pin.length < 4 || confirm.length < 4}
        className="min-h-11 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : `Update ${label} PIN`}
      </button>
      {msg ? <p className="text-xs text-[var(--muted)]">{msg}</p> : null}
    </form>
  );
}

function BatchManager() {
  const [batches, setBatches] = useState<{ id: string; year: string }[]>([]);
  const [year, setYear] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/member-batches", { credentials: "same-origin" });
    if (!res.ok) return;
    const j = (await res.json()) as { batches: { id: string; year: string }[] };
    setBatches(j.batches ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addBatch(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!/^\d{4}$/.test(year)) { setErr("Enter a valid 4-digit year."); return; }
    const res = await fetch("/api/admin/member-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ year }),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      setErr(j.error ?? "Could not add batch");
      return;
    }
    setYear("");
    load();
  }

  async function removeBatch(id: string) {
    await fetch("/api/admin/member-batches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id }),
    });
    load();
  }

  return (
    <div className="space-y-3">
      <form onSubmit={addBatch} className="flex gap-2">
        <input
          className="min-h-11 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
          placeholder="e.g. 2025"
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
          maxLength={4}
        />
        <button
          type="submit"
          className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white"
        >
          Add
        </button>
      </form>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {batches.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No batches added yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {batches.map((b) => (
            <div key={b.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm">
              <span>{b.year}</span>
              <button
                type="button"
                onClick={() => removeBatch(b.id)}
                className="text-[var(--danger)] leading-none"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminSettingsPage() {
  const [church_name, setChurchName] = useState("");
  const [church_address, setChurchAddress] = useState("");
  const [report_title, setReportTitle] = useState("");
  const [report_timezone, setReportTimezone] = useState("Asia/Manila");
  const [attendance_auto_approve_appeals, setAttendanceAutoApproveAppeals] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/settings", { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as {
        church_name: string;
        church_address: string;
        report_title: string;
        report_timezone: string;
        attendance_auto_approve_appeals?: boolean;
      };
      setChurchName(j.church_name);
      setChurchAddress(j.church_address);
      setReportTitle(j.report_title);
      setReportTimezone(j.report_timezone);
      setAttendanceAutoApproveAppeals(j.attendance_auto_approve_appeals === true);
    })();
  }, []);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        church_name,
        church_address,
        report_title,
        report_timezone,
        attendance_auto_approve_appeals,
      }),
    });
    setSaved(true);
  }

  return (
    <div className="space-y-10 pb-8">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">Report header</h2>
        <form onSubmit={saveSettings} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Church name</span>
            <input
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={church_name}
              onChange={(e) => setChurchName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Address</span>
            <input
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={church_address}
              onChange={(e) => setChurchAddress(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Report title</span>
            <input
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={report_title}
              onChange={(e) => setReportTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Timezone (IANA, e.g. Asia/Manila)</span>
            <input
              className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3"
              value={report_timezone}
              onChange={(e) => setReportTimezone(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 rounded border-[var(--border)]"
              checked={attendance_auto_approve_appeals}
              onChange={(e) => setAttendanceAutoApproveAppeals(e.target.checked)}
            />
            <span className="text-sm text-[var(--text)]">
              Auto-approve attendance appeals
              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                When enabled, submitted attendance appeals are added directly to attendance without manual approval.
              </span>
            </span>
          </label>
          <button type="submit" className="min-h-12 w-full rounded-xl bg-[var(--accent)] font-semibold text-white">
            Save header
          </button>
          {saved ? <p className="text-sm text-[var(--muted)]">Saved.</p> : null}
        </form>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">Batch management</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Add or remove batch years used in member information.
        </p>
        <div className="mt-4 space-y-3">
          <BatchManager />
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">PIN management</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Update one role at a time. PINs must be 4–12 characters and match confirmation. Stored hashed on the server.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SinglePinForm role="admin" label="Admin" />
          <SinglePinForm role="secretary" label="Secretary" />
          <SinglePinForm role="member" label="Member" />
          <SinglePinForm role="officer" label="Officer" />
          <SinglePinForm role="treasurer" label="Treasurer" />
        </div>
      </section>
    </div>
  );
}
