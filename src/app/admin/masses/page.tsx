"use client";

import { useCallback, useEffect, useState } from "react";

type Mass = { id: string; name: string; default_sunday: boolean; is_active: boolean };

export default function AdminMassesPage() {
  const [masses, setMasses] = useState<Mass[] | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/masses", { credentials: "same-origin" });
    const j = (await res.json()) as { masses: Mass[] };
    setMasses(j.masses ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/masses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name: name.trim(), default_sunday: false }),
    });
    setName("");
    load();
  }

  async function patch(id: string, patch: Partial<{ default_sunday: boolean; is_active: boolean }>) {
    await fetch(`/api/masses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(patch),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Masses</h1>
      <form onSubmit={add} className="flex gap-2">
        <input
          className="min-h-12 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
          placeholder="Mass name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="min-h-12 rounded-xl bg-[var(--accent)] px-4 font-medium text-white">
          Add
        </button>
      </form>
      {masses === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {masses.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className={m.is_active ? "font-medium" : "font-medium text-[var(--muted)] line-through"}>
                  {m.name}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {m.default_sunday ? "Default on Sundays" : "Manual only"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm"
                  onClick={() => patch(m.id, { default_sunday: !m.default_sunday })}
                >
                  Toggle Sunday default
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm"
                  onClick={() => patch(m.id, { is_active: !m.is_active })}
                >
                  {m.is_active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
