"use client";

import { useState } from "react";

export function OfficerCreateMassForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const n = name.trim();
    if (n.length < 1) return;
    setBusy(true);
    try {
      const res = await fetch("/api/masses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: n }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not create mass");
        return;
      }
      setName("");
      setMsg("Mass added. You can assign servers for it on any date.");
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4 space-y-2"
    >
      <h3 className="text-sm font-semibold text-[var(--text)]">No masses yet</h3>
      <p className="text-xs text-[var(--muted)]">
        Admins usually add masses. You can create one here so you can plan server roles by date.
      </p>
      <input
        className="w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
        placeholder="Mass name (e.g. Sunday 8:00 AM)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="submit"
        disabled={busy || name.trim().length < 1}
        className="min-h-11 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : "Create mass"}
      </button>
      {msg ? <p className="text-xs text-[var(--muted)]">{msg}</p> : null}
    </form>
  );
}
