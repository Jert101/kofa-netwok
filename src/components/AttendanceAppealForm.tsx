"use client";

import { useEffect, useState } from "react";

type Member = { id: string; full_name: string };

export function AttendanceAppealForm({ sessionId }: { sessionId: string }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      (async () => {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`, {
          credentials: "same-origin",
        });
        const j = (await res.json()) as { members?: Member[] };
        setResults(j.members ?? []);
      })();
    }, 180);
    return () => clearTimeout(t);
  }, [term]);

  async function submitAppeal() {
    setMsg(null);
    setSaving(true);
    try {
      const member_ids = [...selected.keys()];
      if (member_ids.length === 0) {
        setMsg("Add at least one name.");
        return;
      }
      const res = await fetch(`/api/attendance/session/${sessionId}/appeals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ member_ids }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not submit appeal.");
        return;
      }
      setSelected(new Map());
      setTerm("");
      setResults([]);
      setMsg("Appeal submitted. Admin/Secretary will review each name.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--accent)]">Attendance appeal</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        If a server is missing in this attendance, add one or more names and submit for review.
      </p>

      <input
        className="mt-3 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4"
        placeholder="Search member name"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <ul className="mt-2 max-h-48 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        {results.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => {
                setSelected((prev) => {
                  const n = new Map(prev);
                  n.set(m.id, m.full_name);
                  return n;
                });
                setTerm("");
                setResults([]);
              }}
              className="min-h-11 w-full px-4 text-left text-sm active:bg-[var(--surface-2)]"
            >
              {m.full_name}
            </button>
          </li>
        ))}
        {term.trim().length > 0 && results.length === 0 ? (
          <li className="px-4 py-3 text-sm text-[var(--muted)]">No results</li>
        ) : null}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        {[...selected.entries()].map(([id, name]) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3 py-2 text-sm">
            {name}
            <button
              type="button"
              className="ml-1 font-bold text-[var(--danger)]"
              onClick={() =>
                setSelected((prev) => {
                  const n = new Map(prev);
                  n.delete(id);
                  return n;
                })
              }
              aria-label={`Remove ${name}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {msg ? <p className="mt-3 text-sm text-[var(--muted)]">{msg}</p> : null}

      <button
        type="button"
        onClick={submitAppeal}
        disabled={saving || selected.size === 0}
        className="mt-3 min-h-12 w-full rounded-xl bg-[var(--accent)] font-semibold text-white disabled:opacity-40"
      >
        {saving ? "Submitting..." : "Submit appeal"}
      </button>
    </section>
  );
}
