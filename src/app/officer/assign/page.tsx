"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type Mass = { id: string; name: string };
type Row = { key: string; position_label: string; member_id: string; member_name: string };

/**
 * Assign a server, by date and by Mass.
 *
 * The same assignment exists in the planned editor, but this page is the one place that says what it
 * does: pick a date and a Mass, and the roster below is exactly what will be saved for that
 * date+mass. Every row maps a position to a member, and every member is searched from the roster.
 * The save writes the whole date+mass set, and the "push to notifications" switch tells the server
 * whether to tell the parish it changed.
 */
export default function OfficerAssignPage() {
  const [date, setDate] = useState("");
  const [masses, setMasses] = useState<Mass[]>([]);
  const [massId, setMassId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sendPush, setSendPush] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newPosition, setNewPosition] = useState("");
  const [newMember, setNewMember] = useState<{ id: string; name: string } | null>(null);

  // Load the Mass list once, and default the date to today.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/masses", { credentials: "same-origin" });
        const body = await res.json().catch(() => ({}));
        const list = ((body as { data?: { masses?: Mass[] } }).data?.masses ?? []) as Mass[];
        setMasses(list);
      } catch {
        setError("Could not load the Mass list.");
      }
    })();
    const t = new Date().toISOString().slice(0, 10);
    setDate((d) => d || t);
  }, []);

  const loadAssignments = useCallback(async () => {
    if (!date || !massId) {
      setRows([]);
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/attendance/liturgy-planned?date=${encodeURIComponent(date)}&mass_id=${encodeURIComponent(massId)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        setError("Could not load the assignment for that date and Mass.");
        setRows(null);
        return;
      }
      const body = (await res.json()) as { slots?: Array<{ position_label: string; member_id: string; member_name?: string | null }> };
      setRows(
        (body.slots ?? []).map((s, i) => ({
          key: `${s.position_label}-${s.member_id}-${i}`,
          position_label: s.position_label,
          member_id: s.member_id,
          member_name: (s.member_name ?? "").trim() || "Member",
        })),
      );
    } catch {
      setError("Could not load the assignment for that date and Mass.");
      setRows(null);
    }
  }, [date, massId]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const addRow = () => {
    if (!newPosition.trim() || !newMember) return;
    setRows((prev) => [
      ...(prev ?? []),
      { key: crypto.randomUUID(), position_label: newPosition.trim(), member_id: newMember.id, member_name: newMember.name },
    ]);
    setNewPosition("");
    setNewMember(null);
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev ?? []).filter((r) => r.key !== key));
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    const slots = (rows ?? []).map((r) => ({ position_label: r.position_label.trim(), member_id: r.member_id }));
    const res = await fetch("/api/attendance/liturgy-planned", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_date: date, mass_id: massId, slots, send_push: sendPush }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not save the assignment.");
      return;
    }
    setNotice(sendPush ? "Assignment saved and a notification was sent." : "Assignment saved quietly (no notification).");
  };

  const clearAll = async () => {
    if (!date || !massId) return;
    if (!window.confirm("Remove every assigned server for that date and Mass? This cannot be undone.")) return;
    setError(null);
    setNotice(null);
    const res = await fetch(
      `/api/attendance/liturgy-planned?date=${encodeURIComponent(date)}&mass_id=${encodeURIComponent(massId)}`,
      { method: "DELETE", credentials: "same-origin" },
    );
    if (!res.ok) {
      setError("Could not clear the assignment.");
      return;
    }
    setRows([]);
    setNotice("Cleared the assignment for that date and Mass.");
  };

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-lg font-semibold sm:text-xl">Assign a server</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Choose a date and a Mass, then give each position its server. Every row is one position and
          its server, and you decide whether saving tells the parish about the change.
        </p>
      </header>

      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-[var(--text-muted)]">{notice}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-[var(--text-muted)]">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setRows(null);
            }}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--text-muted)]">Mass</span>
          <select
            value={massId}
            onChange={(e) => {
              setMassId(e.target.value);
              setRows(null);
            }}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          >
            <option value="">Choose a Mass…</option>
            {masses.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-medium">Positions for {masses.find((m) => m.id === massId)?.name ?? "that Mass"}</h2>

        {rows === null && date && massId ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">Loading…</p>
        ) : null}

        {(rows ?? []).length === 0 && !(rows === null && date && massId) ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">No servers are assigned yet.</p>
        ) : null}

        {(rows ?? []).length > 0 ? (
          <ul className="mt-3 space-y-2">
            {(rows ?? []).map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.position_label}</span>
                <span className="text-sm text-[var(--text-muted)]">→ {r.member_name}</span>
                <Button size="sm" variant="ghost" onClick={() => removeRow(r.key)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={newPosition}
              onChange={(e) => setNewPosition(e.target.value)}
              placeholder="Position (e.g. Thurifer)"
              className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
            />
            <MemberPick value={newMember} onChange={setNewMember} />
            <Button size="sm" onClick={addRow} disabled={!newPosition.trim() || !newMember}>
              Add
            </Button>
          </div>
        </div>
      </section>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sendPush} onChange={(e) => setSendPush(e.target.checked)} />
        <span>Push a notification to members about this assignment</span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={!massId || !date}>
          Save assignment
        </Button>
        <Button variant="outline" onClick={() => void clearAll()} disabled={!massId || !date}>
          Clear all
        </Button>
      </div>
    </div>
  );
}

/** Small single-member picker against `/api/members/search`, because the assign save needs a real
 *  member id, not a free-text name. */
function MemberPick({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
}) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; full_name: string }>>([]);
  const [open, setOpen] = useState(false);
  const owner = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}&limit=8`, { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { members?: Array<{ id: string; full_name: string }> };
        if (!cancelled) setHits(body.members ?? []);
      } catch {
        /* search must not interrupt typing */
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
        <span className="min-w-0 flex-1 truncate">{value.name}</span>
        <button type="button" className="text-[var(--danger)]" onClick={() => onChange(null)} aria-label="Change member">
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={owner}>
      <input
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search member"
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
      />
      {open && term.trim().length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {hits.length === 0 ? (
            <li className="px-3 py-3 text-sm text-[var(--text-muted)]">No names match.</li>
          ) : (
            hits.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 text-left text-base active:bg-[var(--surface-2)]"
                  onClick={() => {
                    onChange({ id: m.id, name: m.full_name });
                    setTerm("");
                    setOpen(false);
                  }}
                >
                  {m.full_name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}