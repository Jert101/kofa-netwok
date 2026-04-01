"use client";

import { useEffect, useState } from "react";

export default function AdminSettingsPage() {
  const [church_name, setChurchName] = useState("");
  const [church_address, setChurchAddress] = useState("");
  const [report_title, setReportTitle] = useState("");
  const [report_timezone, setReportTimezone] = useState("Asia/Manila");
  const [saved, setSaved] = useState(false);

  const [admin_pin, setAdminPin] = useState("");
  const [admin_confirm, setAdminConfirm] = useState("");
  const [secretary_pin, setSecretaryPin] = useState("");
  const [secretary_confirm, setSecretaryConfirm] = useState("");
  const [member_pin, setMemberPin] = useState("");
  const [member_confirm, setMemberConfirm] = useState("");
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/settings", { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as {
        church_name: string;
        church_address: string;
        report_title: string;
        report_timezone: string;
      };
      setChurchName(j.church_name);
      setChurchAddress(j.church_address);
      setReportTitle(j.report_title);
      setReportTimezone(j.report_timezone);
    })();
  }, []);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ church_name, church_address, report_title, report_timezone }),
    });
    setSaved(true);
  }

  async function savePins(e: React.FormEvent) {
    e.preventDefault();
    setPinMsg(null);
    const res = await fetch("/api/admin/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        admin_pin,
        admin_confirm,
        secretary_pin,
        secretary_confirm,
        member_pin,
        member_confirm,
      }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setPinMsg(j.error ?? "Could not update PINs");
      return;
    }
    setPinMsg("PINs updated. Sign in again on other devices.");
    setAdminPin("");
    setAdminConfirm("");
    setSecretaryPin("");
    setSecretaryConfirm("");
    setMemberPin("");
    setMemberConfirm("");
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
          <button type="submit" className="min-h-12 w-full rounded-xl bg-[var(--accent)] font-semibold text-white">
            Save header
          </button>
          {saved ? <p className="text-sm text-[var(--muted)]">Saved.</p> : null}
        </form>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">PIN management</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Set all three PINs. Each must match its confirmation field. Stored hashed on the server.
        </p>
        <form onSubmit={savePins} className="mt-4 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--muted)]">Admin</legend>
            <input
              type="password"
              inputMode="numeric"
              className="w-full min-h-12 rounded-xl border border-[var(--border)] px-3"
              placeholder="New PIN"
              value={admin_pin}
              onChange={(e) => setAdminPin(e.target.value)}
            />
            <input
              type="password"
              inputMode="numeric"
              className="w-full min-h-12 rounded-xl border border-[var(--border)] px-3"
              placeholder="Confirm"
              value={admin_confirm}
              onChange={(e) => setAdminConfirm(e.target.value)}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--muted)]">Secretary</legend>
            <input
              type="password"
              inputMode="numeric"
              className="w-full min-h-12 rounded-xl border border-[var(--border)] px-3"
              placeholder="New PIN"
              value={secretary_pin}
              onChange={(e) => setSecretaryPin(e.target.value)}
            />
            <input
              type="password"
              inputMode="numeric"
              className="w-full min-h-12 rounded-xl border border-[var(--border)] px-3"
              placeholder="Confirm"
              value={secretary_confirm}
              onChange={(e) => setSecretaryConfirm(e.target.value)}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--muted)]">Member</legend>
            <input
              type="password"
              inputMode="numeric"
              className="w-full min-h-12 rounded-xl border border-[var(--border)] px-3"
              placeholder="New PIN"
              value={member_pin}
              onChange={(e) => setMemberPin(e.target.value)}
            />
            <input
              type="password"
              inputMode="numeric"
              className="w-full min-h-12 rounded-xl border border-[var(--border)] px-3"
              placeholder="Confirm"
              value={member_confirm}
              onChange={(e) => setMemberConfirm(e.target.value)}
            />
          </fieldset>
          <button type="submit" className="min-h-12 w-full rounded-xl border-2 border-[var(--danger)] font-semibold text-[var(--danger)]">
            Update all PINs
          </button>
          {pinMsg ? <p className="text-sm text-[var(--muted)]">{pinMsg}</p> : null}
        </form>
      </section>
    </div>
  );
}
