"use client";

import { useCallback, useEffect, useState } from "react";

type Member = { id: string; full_name: string };

export type LiturgyRow = {
  position_label: string;
  member_id: string | null;
  member_name: string | null;
  free_text: string | null;
};

type RoleBlock = {
  position_label: string;
  members: { id: string; full_name: string }[];
};

function rowsToRoleBlocks(rows: LiturgyRow[]): RoleBlock[] {
  const order: string[] = [];
  const map = new Map<string, { id: string; full_name: string }[]>();
  for (const r of rows) {
    const label = r.position_label;
    if (!map.has(label)) {
      order.push(label);
      map.set(label, []);
    }
    if (r.member_id && r.member_name) {
      const list = map.get(label)!;
      if (!list.some((x) => x.id === r.member_id)) {
        list.push({ id: r.member_id, full_name: r.member_name });
      }
    }
  }
  if (order.length === 0) return [{ position_label: "", members: [] }];
  return order.map((position_label) => ({
    position_label,
    members: map.get(position_label) ?? [],
  }));
}

function roleBlocksToRows(blocks: RoleBlock[]): Array<{ position_label: string; member_id: string }> {
  const out: Array<{ position_label: string; member_id: string }> = [];
  for (const b of blocks) {
    const label = b.position_label.trim();
    if (!label) continue;
    for (const m of b.members) {
      out.push({ position_label: label, member_id: m.id });
    }
  }
  return out;
}

type SessionMode = {
  mode: "session";
  sessionId: string;
  initialRows: LiturgyRow[];
  onSaved?: () => void;
};

type PlannedMode = {
  mode: "planned";
  sessionDate: string;
  massId: string;
  massName: string;
  initialRows: LiturgyRow[];
  onSaved?: () => void;
};

export type LiturgyServerEditorProps = SessionMode | PlannedMode;

export function LiturgyServerEditor(props: LiturgyServerEditorProps) {
  const [roles, setRoles] = useState<RoleBlock[]>(() => rowsToRoleBlocks(props.initialRows));
  const [searchRoleIdx, setSearchRoleIdx] = useState<number | null>(null);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setRoles(rowsToRoleBlocks(props.initialRows));
  }, [props.initialRows]);

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

  const addMemberToRole = useCallback((roleIdx: number, m: Member) => {
    setRoles((prev) => {
      const next = prev.map((r, i) =>
        i === roleIdx
          ? {
              ...r,
              members: r.members.some((x) => x.id === m.id) ? r.members : [...r.members, m],
            }
          : r
      );
      return next;
    });
    setSearchRoleIdx(null);
    setTerm("");
    setResults([]);
  }, []);

  const removeMemberFromRole = useCallback((roleIdx: number, memberId: string) => {
    setRoles((prev) =>
      prev.map((r, i) =>
        i === roleIdx ? { ...r, members: r.members.filter((x) => x.id !== memberId) } : r
      )
    );
  }, []);

  function addRole() {
    setRoles((r) => [...r, { position_label: "", members: [] }]);
  }

  function removeRole(i: number) {
    setRoles((r) => (r.length <= 1 ? r : r.filter((_, j) => j !== i)));
  }

  async function save() {
    setMsg(null);
    const flat = roleBlocksToRows(roles);
    for (const b of roles) {
      const label = b.position_label.trim();
      if (!label) continue;
      if (b.members.length === 0) {
        setMsg(`"${label}" needs at least one member from the directory.`);
        return;
      }
    }
    if (flat.length === 0) {
      setMsg("Add at least one role with a member.");
      return;
    }

    setSaving(true);
    try {
      let res: Response;
      if (props.mode === "session") {
        res = await fetch(`/api/attendance/session/${props.sessionId}/liturgy-servers`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ slots: flat }),
        });
      } else {
        res = await fetch("/api/attendance/liturgy-planned", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            session_date: props.sessionDate,
            mass_id: props.massId,
            slots: flat,
          }),
        });
      }
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not save.");
        return;
      }
      setMsg(
        props.mode === "planned"
          ? "Saved. Subscribers with push enabled were notified."
          : "Saved. Subscribers with push enabled were notified."
      );
      props.onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    if (!confirm("Remove all server assignments for this mass?")) return;
    setMsg(null);
    setSaving(true);
    try {
      let res: Response;
      if (props.mode === "session") {
        res = await fetch(`/api/attendance/session/${props.sessionId}/liturgy-servers`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ slots: [] }),
        });
      } else {
        res = await fetch("/api/attendance/liturgy-planned", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            session_date: props.sessionDate,
            mass_id: props.massId,
            slots: [],
          }),
        });
      }
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "Could not clear.");
        return;
      }
      setRoles([{ position_label: "", members: [] }]);
      setMsg("All assignments removed.");
      props.onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  const heading =
    props.mode === "planned" ? `Plan ahead · ${props.massName}` : "Liturgy servers (roles)";
  const sub =
    props.mode === "planned"
      ? "No attendance session is required yet. When the secretary schedules this mass for this date, these roles carry over automatically."
      : "Add roles (e.g. Crucifix, Candle). Under each role, add one or more members from the directory.";

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--accent)]">{heading}</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p>

      <ul className="mt-4 space-y-4">
        {roles.map((role, i) => (
          <li key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <label className="block text-xs font-medium text-[var(--muted)]">Role / position</label>
            <input
              className="mt-1 w-full min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3"
              placeholder="e.g. Crucifix, Candle"
              value={role.position_label}
              onChange={(e) => {
                const v = e.target.value;
                setRoles((prev) => {
                  const n = [...prev];
                  n[i] = { ...n[i], position_label: v };
                  return n;
                });
              }}
            />

            <p className="mt-3 text-xs font-medium text-[var(--muted)]">Members from directory</p>
            {role.members.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {role.members.map((m) => (
                  <li
                    key={m.id}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                  >
                    <span>{m.full_name}</span>
                    <button
                      type="button"
                      className="text-[var(--danger)]"
                      aria-label={`Remove ${m.full_name}`}
                      onClick={() => removeMemberFromRole(i, m.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted)]">None yet — search below to add.</p>
            )}

            <input
              className="mt-2 w-full min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3"
              placeholder="Search member to add…"
              value={searchRoleIdx === i ? term : ""}
              onFocus={() => {
                setSearchRoleIdx(i);
                setTerm("");
              }}
              onChange={(e) => {
                setSearchRoleIdx(i);
                setTerm(e.target.value);
              }}
            />
            {searchRoleIdx === i && results.length > 0 ? (
              <ul className="mt-1 max-h-36 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                {results.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]"
                      onClick={() => addMemberToRole(i, m)}
                    >
                      {m.full_name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <button type="button" className="mt-3 text-sm text-[var(--danger)]" onClick={() => removeRole(i)}>
              Remove this role
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm font-medium"
          onClick={addRole}
        >
          Add role
        </button>
        <button
          type="button"
          disabled={saving}
          className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-medium text-white disabled:opacity-40"
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save assignments"}
        </button>
        <button
          type="button"
          disabled={saving}
          className="min-h-11 rounded-xl border border-[var(--danger)] px-4 text-sm text-[var(--danger)] disabled:opacity-40"
          onClick={() => void clearAll()}
        >
          Remove all
        </button>
      </div>
      {msg ? <p className="mt-2 text-sm text-[var(--muted)]">{msg}</p> : null}
    </section>
  );
}
