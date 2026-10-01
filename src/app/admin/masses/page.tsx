"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Clock, Pencil, Plus } from "lucide-react";

type Mass = {
  id: string;
  name: string;
  default_sunday: boolean;
  default_time: string | null;
  is_active: boolean;
  sort_order: number;
};

type Draft = {
  name: string;
  default_time: string;
  default_sunday: boolean;
} | null;

/**
 * ATT-1 Masses catalog.
 *
 * The order of this list is the order of the day view, so reordering is a first-class
 * control rather than a field to type a number into. Reorder arrows swap neighbours in
 * place instead of renumbering the list, which means two people reordering at once
 * cannot overwrite each other's whole sequence.
 *
 * Deactivate, never delete. A Mass that has been celebrated has history attached to it,
 * and deleting it would either erase that history or orphan every session that pointed
 * at it.
 */
export default function AdminMassesPage() {
  const [masses, setMasses] = useState<Mass[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/masses", { credentials: "same-origin" });
      if (!res.ok) {
        setLoadFailed(true);
        setMasses([]);
        return;
      }
      const j = (await res.json()) as { masses: Mass[] };
      setLoadFailed(false);
      setMasses(j.masses ?? []);
    } catch {
      setLoadFailed(true);
      setMasses([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(method: "POST" | "PATCH", id: string | null, body: unknown) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(id ? `/api/masses/${id}` : "/api/masses", {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) {
        setError(j?.message ?? j?.error ?? "Could not save.");
        return false;
      }
      setDraft(null);
      setEditingId(null);
      await load();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Reorder keeps the row in place so the list does not jump under the pointer. */
  async function move(mass: Mass, direction: "up" | "down") {
    setError(null);
    try {
      const res = await fetch(`/api/masses/${mass.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ direction }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "Could not change the order.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    }
  }

  const list = masses ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Masses</h1>
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          onClick={() => {
            setEditingId(null);
            setError(null);
            setDraft({ name: "", default_time: "", default_sunday: false });
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add Mass
        </Button>
      </div>

      <p className="text-sm text-[var(--muted)]">
        This order is the order they appear on the day view. Only Sunday Masses are created
        automatically by the weekly job.
      </p>

      {draft ? (
        <form
          className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = draft.name.trim();
            if (!name) {
              setError("A Mass needs a name.");
              return;
            }
            await send(editingId ? "PATCH" : "POST", editingId, {
              name,
              default_time: draft.default_time || null,
              default_sunday: draft.default_sunday,
            });
          }}
        >
          <div>
            <label htmlFor="mass-name" className="text-sm font-medium text-[var(--muted)]">
              Name
            </label>
            <input
              id="mass-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              maxLength={120}
              className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
              placeholder="First Mass"
            />
          </div>

          <div>
            <label htmlFor="mass-time" className="text-sm font-medium text-[var(--muted)]">
              Usual time
            </label>
            <div className="relative mt-1">
              <Clock
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]"
              />
              <input
                id="mass-time"
                type="time"
                value={draft.default_time}
                onChange={(e) => setDraft({ ...draft, default_time: e.target.value })}
                className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3"
              />
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Used as a reminder when adding a session. Leaving it empty is fine.
            </p>
          </div>

          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.default_sunday}
              onChange={(e) => setDraft({ ...draft, default_sunday: e.target.checked })}
              className="size-5"
            />
            <span className="text-sm">Create this automatically every Sunday</span>
          </label>

          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={saving} className="min-h-11">
              {saving ? "Saving…" : editingId ? "Save" : "Add Mass"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {masses === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : loadFailed ? (
        <div role="alert" className="rounded-2xl border border-dashed border-[var(--danger)] p-6 text-center">
          <p className="text-sm font-medium text-[var(--danger)]">Could not load the Mass list.</p>
          <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No Masses yet. Add one to start encoding attendance.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((mass, index) => (
            <li
              key={mass.id}
              className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p
                  className={
                    mass.is_active ? "font-medium" : "font-medium text-[var(--muted)] line-through"
                  }
                >
                  {mass.name}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {mass.default_time ? `${mass.default_time.slice(0, 5)} · ` : ""}
                  {mass.default_sunday ? "every Sunday" : "manual only"}
                  {mass.is_active ? "" : " · inactive"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${mass.name} up`}
                    disabled={index === 0}
                    onClick={() => void move(mass, "up")}
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${mass.name} down`}
                    disabled={index === list.length - 1}
                    onClick={() => void move(mass, "down")}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  onClick={() => {
                    setEditingId(mass.id);
                    setError(null);
                    setDraft({
                      name: mass.name,
                      default_time: mass.default_time?.slice(0, 5) ?? "",
                      default_sunday: mass.default_sunday,
                    });
                  }}
                >
                  <Pencil aria-hidden="true" className="size-4" />
                  Edit
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  onClick={() => void send("PATCH", mass.id, { is_active: !mass.is_active })}
                >
                  {mass.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && !draft ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
