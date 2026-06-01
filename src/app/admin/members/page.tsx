"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Member = { id: string; full_name: string; is_active: boolean };

type NameParts = {
  first: string;
  middle: string;
  last: string;
};

function parseName(full: string): NameParts {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: "", middle: "", last: "" };
  if (parts.length === 1) return { first: parts[0], middle: "", last: "" };

  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1);

  const middleCandidates = rest.filter((p) => p.endsWith("."));
  const nonMiddle = rest.filter((p) => !p.endsWith("."));

  if (middleCandidates.length === 1 && nonMiddle.length === 1) {
    return {
      first: nonMiddle[0],
      middle: middleCandidates[0].replace(".", ""),
      last,
    };
  }

  return { first: rest.join(" "), middle: "", last };
}

function composeName(parts: NameParts): string {
  const { first, middle, last } = parts;
  const trimmed = [first.trim(), middle.trim() ? `${middle.trim()}.` : "", last.trim()]
    .filter(Boolean)
    .join(" ");
  return trimmed
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizeName(s: string) {
  return s.trim().toLowerCase();
}

function nameExists(members: Member[], fullName: string, opts?: { excludeId?: string }) {
  const n = normalizeName(fullName);
  if (!n) return false;
  return members.some(
    (m) =>
      m.is_active &&
      normalizeName(m.full_name) === n &&
      (opts?.excludeId === undefined || m.id !== opts.excludeId),
  );
}

function NameFormFields({
  parts,
  onChange,
}: {
  parts: NameParts;
  onChange: (next: NameParts) => void;
}) {
  function update(field: keyof NameParts, value: string) {
    onChange({ ...parts, [field]: value });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        className="min-h-11 flex-1 rounded-lg border border-[var(--border)] px-2"
        placeholder="First name"
        value={parts.first}
        onChange={(e) => update("first", e.target.value)}
      />
      <input
        className="min-h-11 w-20 rounded-lg border border-[var(--border)] px-2 text-center"
        placeholder="MI"
        maxLength={2}
        value={parts.middle}
        onChange={(e) => update("middle", e.target.value)}
      />
      <input
        className="min-h-11 flex-1 rounded-lg border border-[var(--border)] px-2"
        placeholder="Last name"
        value={parts.last}
        onChange={(e) => update("last", e.target.value)}
      />
    </div>
  );
}

export default function AdminMembersPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [addParts, setAddParts] = useState<NameParts>({ first: "", middle: "", last: "" });
  const [search, setSearch] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editParts, setEditParts] = useState<NameParts>({ first: "", middle: "", last: "" });

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/members?all=1", { credentials: "same-origin" });
    const j = (await res.json()) as { members: Member[] };
    setMembers(j.members ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredMembers = useMemo(() => {
    if (members === null) return [];
    const t = search.trim().toLowerCase();
    if (!t) return members;
    return members.filter((m) => m.full_name.toLowerCase().includes(t));
  }, [members, search]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const fullName = composeName(addParts);
    if (!fullName) return;
    if (members && nameExists(members, fullName)) {
      setAddError("This name already exists.");
      return;
    }
    const res = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ full_name: fullName }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setAddError(res.status === 409 ? "This name already exists." : j.error ?? "Could not add member.");
      return;
    }
    setAddParts({ first: "", middle: "", last: "" });
    load();
  }

  async function save(id: string) {
    setEditError(null);
    const fullName = composeName(editParts);
    if (!fullName) return;
    if (members && nameExists(members, fullName, { excludeId: id })) {
      setEditError("This name already exists.");
      return;
    }
    const res = await fetch(`/api/admin/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ full_name: fullName }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setEditError(res.status === 409 ? "This name already exists." : j.error ?? "Could not save.");
      return;
    }
    setEditing(null);
    load();
  }

  async function toggleActive(id: string, is_active: boolean) {
    await fetch(`/api/admin/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ is_active: !is_active }),
    });
    load();
  }

  function startEdit(m: Member) {
    const parts = parseName(m.full_name);
    setEditParts(parts);
    setEditing(m.id);
    setEditError(null);
  }

  const addFull = composeName(addParts);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Members</h1>
        <div className="flex items-center gap-2">
          {members !== null ? (
            <p className="text-sm text-[var(--muted)]" aria-live="polite">
              Total: <span className="font-medium text-[var(--foreground)]">{members.length}</span>
            </p>
          ) : null}
          <Link
            href="/api/admin/members/pdf"
            className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--accent)]"
          >
            Download active list (PDF)
          </Link>
        </div>
      </div>

      <form onSubmit={add} className="space-y-2">
        <NameFormFields parts={addParts} onChange={setAddParts} />
        <div className="flex items-center gap-3">
          <button type="submit" className="min-h-12 rounded-xl bg-[var(--accent)] px-4 font-medium text-white">
            Add
          </button>
          {addFull ? (
            <span className="text-sm text-[var(--muted)]">Preview: {addFull}</span>
          ) : null}
        </div>
        {addError ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {addError}
          </p>
        ) : null}
      </form>

      <div>
        <label htmlFor="member-search" className="sr-only">
          Search members
        </label>
        <input
          id="member-search"
          type="search"
          className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
          placeholder="Search members"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
        {members !== null && search.trim() !== "" ? (
          <p className="mt-1 text-sm text-[var(--muted)]" aria-live="polite">
            Showing {filteredMembers.length} of {members.length}
          </p>
        ) : null}
      </div>

      {members === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : filteredMembers.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {members.length === 0 ? "No members yet." : "No members match your search."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filteredMembers.map((m) => (
            <li key={m.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              {editing === m.id ? (
                <div className="flex flex-col gap-2">
                  <NameFormFields parts={editParts} onChange={setEditParts} />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="min-h-11 rounded-lg bg-[var(--accent)] px-3 text-white"
                      onClick={() => save(m.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="min-h-11"
                      onClick={() => {
                        setEditing(null);
                        setEditError(null);
                      }}
                    >
                      Cancel
                    </button>
                    {composeName(editParts) ? (
                      <span className="text-sm text-[var(--muted)]">
                        Preview: {composeName(editParts)}
                      </span>
                    ) : null}
                  </div>
                  {editError ? (
                    <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                      {editError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={m.is_active ? "" : "text-[var(--muted)] line-through"}>{m.full_name}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-sm text-[var(--accent)]"
                      onClick={() => startEdit(m)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-sm text-[var(--muted)]"
                      onClick={() => toggleActive(m.id, m.is_active)}
                    >
                      {m.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
