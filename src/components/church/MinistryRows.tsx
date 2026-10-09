"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  MINISTRY_EDITOR_FIELDS,
  MINISTRY_KINDS,
  MINISTRY_LABEL,
  MINISTRY_TABLE_LABEL,
  type MinistryKind,
} from "@/lib/church/ministry";

/**
 * Add, edit, reorder and remove one of the three published ministry lists.
 *
 * One component for roles, milestones and patrons, because the three are the same three actions with
 * different columns. Written three times they would drift apart -- and the copy that drifts is always
 * the one nobody tests, because the drag-handle in it only exists on the council.
 *
 * ## Saving on blur, not on a Save button
 *
 * Each field saves itself when it loses focus and has actually changed. That is what the council rows
 * do, and it is deliberate: a list of short rows with one Save button per row is a wall of buttons, and
 * a person who edits one name and clicks away has to hunt for which button belonged to it.
 *
 * The comparison is on the trimmed value, so a field that is refocused without being touched does not
 * send a request -- which matters because an unchanged blur would otherwise write the same value back
 * and bump `updated_at` for no reason.
 *
 * ## The new-row form asks before creating
 *
 * Same reasoning as the council fix: a row created blank is a row the API refuses, and it is a state
 * worth not being able to reach. The form stays open on failure so a name is never retyped.
 */

type Row = { id: string } & Record<string, unknown>;

export function MinistryRows({
  kind,
  rows,
  onChange,
  onError,
  onNotice,
}: {
  kind: MinistryKind;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const fields = MINISTRY_EDITOR_FIELDS[kind];
  const singular = MINISTRY_LABEL[kind];

  const setRowField = (id: string, column: string, value: unknown) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, [column]: value } : r)));
  };

  const saveRow = async (id: string, patch: Record<string, unknown>) => {
    setBusy(id);
    onError(null);
    // Captured before anything changes: it is what a refusal has to put back.
    const before = rows;
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      const res = await fetch(`/api/church/ministry/${kind}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        onChange(before);
        onError(messageFrom(body) ?? `Could not save that ${singular.toLowerCase()} entry.`);
        return;
      }
    } catch {
      onChange(before);
      onError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const addRow = async () => {
    setBusy("new");
    onError(null);
    try {
      const res = await fetch(`/api/church/ministry/${kind}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await res.json().catch(() => ({}))) as unknown;
      const row = (body as { data?: { row?: Row } } | undefined)?.data?.row;
      if (!res.ok || !row) {
        // The server's words. Migration 040 is the likely answer on a database that has not been
        // updated, and that has to be said rather than guessed at from here.
        onError(messageFrom(body) ?? `Could not add to ${MINISTRY_TABLE_LABEL[kind]}.`);
        return;
      }
      onChange([...rows, row]);
      setDraft({});
      setAdding(false);
      onNotice(`Added to ${singular.toLowerCase()}.`);
    } catch {
      onError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const removeRow = async (id: string, label: string) => {
    if (!window.confirm(`Remove "${label}" for good? To keep the entry but hide it from the page, cancel and edit it instead.`)) {
      return;
    }
    setBusy(id);
    onError(null);
    try {
      const res = await fetch(`/api/church/ministry/${kind}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        onError(messageFrom(body) ?? `Could not remove that ${singular.toLowerCase()} entry.`);
        return;
      }
      onChange(rows.filter((r) => r.id !== id));
      onNotice("Removed.");
    } catch {
      onError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const move = async (id: string, direction: -1 | 1) => {
    const index = rows.findIndex((r) => r.id === id);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= rows.length) return;
    const next = [...rows];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    onChange(next);
    // Both rows are written, because the order is a number on each row and one of them has to change.
    // Sequential rather than parallel: two simultaneous updates of the same table in an order that
    // matters is a race for no benefit at this scale.
    await saveRow(id, { sort_order: rows[swapWith].sort_order });
    await saveRow(rows[swapWith].id, { sort_order: rows[index].sort_order });
  };

  return (
    <div className="mt-3 space-y-2">
      {rows.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-4 text-sm text-[var(--text-muted)]">
          Nothing here yet. This section is simply left off the landing page until there is.
        </p>
      ) : null}

      {rows.map((row, index) => (
        <div
          key={row.id}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((spec) =>
              spec.choices ? (
                <label key={spec.column} className="block text-xs text-[var(--text-muted)]">
                  <span className="mb-1 block">{spec.label}</span>
                  <select
                    value={String(row[spec.column] ?? spec.choices[0])}
                    onChange={(e) => setRowField(row.id, spec.column, e.target.value)}
                    className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm capitalize"
                  >
                    {spec.choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={spec.column} className="block text-xs text-[var(--text-muted)]">
                  <span className="mb-1 block">{spec.label}</span>
                  {spec.multiline ? (
                    <textarea
                      value={String(row[spec.column] ?? "")}
                      onChange={(e) => setRowField(row.id, spec.column, e.target.value)}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next === String(row[spec.column] ?? "").trim()) return;
                        void saveRow(row.id, { [spec.column]: next });
                      }}
                      rows={2}
                      placeholder={spec.placeholder}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                    />
                  ) : (
                    <input
                      value={String(row[spec.column] ?? "")}
                      onChange={(e) => setRowField(row.id, spec.column, e.target.value)}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next === String(row[spec.column] ?? "").trim()) return;
                        void saveRow(row.id, { [spec.column]: next });
                      }}
                      placeholder={spec.placeholder}
                      className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                    />
                  )}
                </label>
              ),
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void move(row.id, -1)}
              disabled={busy === row.id || index === 0}
              aria-label="Move up"
            >
              Up
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void move(row.id, 1)}
              disabled={busy === row.id || index === rows.length - 1}
              aria-label="Move down"
            >
              Down
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-[var(--danger-text)]"
              onClick={() => void removeRow(row.id, String(row[fields[0].column] ?? "this entry"))}
              disabled={busy === row.id}
            >
              <Trash2 aria-hidden className="size-4" />
              Remove
            </Button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((spec) =>
              spec.choices ? (
                <label key={spec.column} className="block text-xs text-[var(--text-muted)]">
                  <span className="mb-1 block">{spec.label}</span>
                  <select
                    value={draft[spec.column] ?? spec.choices[0]}
                    onChange={(e) => setDraft((d) => ({ ...d, [spec.column]: e.target.value }))}
                    className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm capitalize"
                  >
                    {spec.choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={spec.column} className="block text-xs text-[var(--text-muted)]">
                  <span className="mb-1 block">{spec.label}</span>
                  <input
                    value={draft[spec.column] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [spec.column]: e.target.value }))}
                    placeholder={spec.placeholder}
                    className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                  />
                </label>
              ),
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={busy === "new" || !firstFieldFilled(kind, draft)}
              onClick={() => void addRow()}
            >
              {busy === "new" ? "Adding…" : "Add"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy === "new"}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={adding}>
          <Plus aria-hidden />
          Add an entry
        </Button>
      )}
    </div>
  );
}

/** Whether the one field with no blank value has been filled in. */
function firstFieldFilled(kind: MinistryKind, draft: Record<string, string>): boolean {
  const required = kind === "milestone" ? "body" : "name";
  return (draft[required] ?? "").trim().length > 0;
}

/**
 * The server's own message, from either response shape.
 *
 * Both exist because this module predates the API envelope standardisation that was deliberately
 * deferred: the church routes answer `{ error }` and the guard answers `{ error: { message } }`.
 */
function messageFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

export { MINISTRY_KINDS };