"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Mass = { id: string; name: string; default_sunday: boolean };
type M = { id: string; full_name: string };

type Props =
  | {
      mode: "create";
      sessionDate: string;
    }
  | {
      mode: "edit";
      sessionId: string;
    };

export function SecretaryAttendanceForm(props: Props) {
  const router = useRouter();
  const [masses, setMasses] = useState<Mass[]>([]);
  const [massId, setMassId] = useState("");
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<M[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/masses", { credentials: "same-origin" });
      const j = (await res.json()) as { masses: Mass[] };
      setMasses(j.masses ?? []);
      if (props.mode === "create" && j.masses?.[0]) setMassId(j.masses[0].id);
    })();
  }, [props.mode]);

  const editSessionId = props.mode === "edit" ? props.sessionId : null;

  useEffect(() => {
    if (!editSessionId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/attendance/session/${editSessionId}`, { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as {
        session: { mass_id: string; mass_name: string; session_date: string };
        members: { member_id: string; full_name: string }[];
      };
      if (cancelled) return;
      const resMasses = await fetch("/api/masses", { credentials: "same-origin" });
      const mj = (await resMasses.json()) as { masses: Mass[] };
      setMasses(mj.masses ?? []);
      setMassId(j.session.mass_id);
      const map = new Map<string, string>();
      for (const m of j.members) map.set(m.member_id, m.full_name);
      setSelected(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [editSessionId]);

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
        const j = (await res.json()) as { members: M[] };
        setResults(j.members ?? []);
      })();
    }, 180);
    return () => clearTimeout(t);
  }, [term]);

  const addMember = useCallback((m: M) => {
    setSelected((prev) => {
      const n = new Map(prev);
      n.set(m.id, m.full_name);
      return n;
    });
    setTerm("");
    setResults([]);
  }, []);

  const removeMember = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Map(prev);
      n.delete(id);
      return n;
    });
  }, []);

  async function submit() {
    setErr(null);
    setSaving(true);
    try {
      const member_ids = [...selected.keys()];
      if (props.mode === "create") {
        if (!massId) {
          setErr("Choose a mass");
          return;
        }
        const res = await fetch("/api/attendance/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            session_date: props.sessionDate,
            mass_id: massId,
            member_ids,
          }),
        });
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          setErr(j.error ?? "Save failed");
          return;
        }
        await res.json();
        router.replace(`/secretary/day/${props.sessionDate}`);
      } else {
        const res = await fetch(`/api/attendance/session/${props.sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ member_ids }),
        });
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          setErr(j.error ?? "Save failed");
          return;
        }
        router.back();
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeSession() {
    if (props.mode !== "edit") return;
    if (!confirm("Delete this attendance session?")) return;
    await fetch(`/api/attendance/session/${props.sessionId}`, { method: "DELETE", credentials: "same-origin" });
    router.replace("/secretary");
  }

  return (
    <div className="space-y-4">
      {props.mode === "create" ? (
        <p className="text-sm text-[var(--muted)]">{props.sessionDate}</p>
      ) : null}
      <label className="block">
        <span className="text-sm font-medium text-[var(--muted)]">Mass</span>
        <select
          className="mt-2 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
          value={massId}
          onChange={(e) => setMassId(e.target.value)}
          disabled={props.mode === "edit"}
        >
          <option value="">Select…</option>
          {masses.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.default_sunday ? " (Sunday default)" : ""}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="text-sm font-medium text-[var(--muted)]">Add servers</span>
        <input
          className="mt-2 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4"
          placeholder="Search member"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <ul className="mt-2 max-h-48 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="min-h-12 w-full px-4 text-left text-base active:bg-[var(--surface-2)]"
                onClick={() => addMember(m)}
              >
                {m.full_name}
              </button>
            </li>
          ))}
          {term.trim().length >= 1 && results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-[var(--muted)]">No results</li>
          ) : null}
        </ul>
      </div>

      <div>
        <span className="text-sm font-medium text-[var(--muted)]">Selected</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {[...selected.entries()].map(([id, name]) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-3 py-2 text-sm"
            >
              {name}
              <button
                type="button"
                className="ml-1 font-bold text-[var(--danger)]"
                aria-label={`Remove ${name}`}
                onClick={() => removeMember(id)}
              >
                ×
              </button>
            </span>
          ))}
          {selected.size === 0 ? (
            <span className="text-sm text-[var(--muted)]">None yet — search and tap to add</span>
          ) : null}
        </div>
      </div>

      {err ? <p className="text-sm text-[var(--danger)]">{err}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={saving || (props.mode === "create" && !massId)}
        className="min-h-14 w-full rounded-xl bg-[var(--accent)] font-semibold text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : props.mode === "create" ? "Submit" : "Save changes"}
      </button>

      {props.mode === "edit" ? (
        <button
          type="button"
          onClick={removeSession}
          className="min-h-12 w-full rounded-xl border border-[var(--danger)] text-[var(--danger)]"
        >
          Delete session
        </button>
      ) : null}
    </div>
  );
}
