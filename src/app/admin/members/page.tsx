"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMemberFullName } from "@/lib/members/name-format";

type Member = { id: string; full_name: string; is_active: boolean };

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

export default function AdminMembersPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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
    const formatted = formatMemberFullName(name);
    if (!formatted) return;
    if (members && nameExists(members, formatted)) {
      setAddError("This name already exists.");
      return;
    }
    const res = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ full_name: formatted }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setAddError(res.status === 409 ? "This name already exists." : j.error ?? "Could not add member.");
      return;
    }
    setName("");
    load();
  }

  async function save(id: string) {
    setEditError(null);
    const formatted = formatMemberFullName(editName);
    if (!formatted) return;
    if (members && nameExists(members, formatted, { excludeId: id })) {
      setEditError("This name already exists.");
      return;
    }
    const res = await fetch(`/api/admin/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ full_name: formatted }),
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
          <a
            href="/api/admin/members/pdf"
            className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--accent)]"
          >
            Download active list (PDF)
          </a>
        </div>
      </div>
      <form onSubmit={add} className="space-y-2">
        <div className="flex gap-2">
          <input
            className="min-h-12 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            placeholder="Full name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setAddError(null);
            }}
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? "add-name-error" : undefined}
          />
          <button type="submit" className="min-h-12 rounded-xl bg-[var(--accent)] px-4 font-medium text-white">
            Add
          </button>
        </div>
        {addError ? (
          <p id="add-name-error" className="text-sm text-red-600 dark:text-red-400" role="alert">
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
            <li
              key={m.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              {editing === m.id ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      className="min-h-11 flex-1 rounded-lg border border-[var(--border)] px-2"
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value);
                        setEditError(null);
                      }}
                      aria-invalid={editError ? true : undefined}
                      aria-describedby={editError ? `edit-name-error-${m.id}` : undefined}
                    />
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
                  </div>
                  {editError ? (
                    <p id={`edit-name-error-${m.id}`} className="text-sm text-red-600 dark:text-red-400" role="alert">
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
                      onClick={() => {
                        setEditing(m.id);
                        setEditName(m.full_name);
                        setEditError(null);
                      }}
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
