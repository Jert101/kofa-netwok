"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { GENDER_RULES, validateTemplateName, validateTemplatePositions, type GenderRule } from "@/lib/liturgy/rules";

type Template = { id: string; name: string; slot_count?: number };
type DraftPosition = { position_label: string; required_gender: GenderRule };

const GENDER_LABEL: Record<GenderRule, string> = {
  any: "Anyone",
  male: "Male",
  female: "Female",
};

function newPosition(): DraftPosition {
  return { position_label: "", required_gender: "any" };
}

/**
 * Officer's template library.
 *
 * A template is a reusable shape for a Mass: the positions, and what each position needs from the
 * person who fills it. The gender rule is stored on the template rather than on any single Mass,
 * because the template is the thing the officer reuses every week -- a thurifer that must be a woman
 * stays a requirement instead of being retyped each Sunday.
 *
 * All of it goes through `/api/officer/liturgy-templates`.
 */
export default function OfficerTemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create form.
  const [name, setName] = useState("");
  const [positions, setPositions] = useState<DraftPosition[]>([newPosition()]);

  // Inline edit for the one template being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPositions, setEditPositions] = useState<DraftPosition[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/officer/liturgy-templates", { credentials: "same-origin" });
      if (!res.ok) {
        setError("Could not load the templates.");
        return;
      }
      const body = (await res.json()) as { templates?: Template[] };
      setTemplates(body.templates ?? []);
    } catch {
      setError("Could not load the templates.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const n = validateTemplateName(name);
    if (!n.ok) return setNotice(n.message);
    const validated = validateTemplatePositions(positions);
    if (!validated.ok) return setNotice(validated.message);

    setNotice(null);
    const res = await fetch("/api/officer/liturgy-templates", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n.name, position_labels: validated.positions }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(body.error ?? "Could not create the template.");
      return;
    }
    setName("");
    setPositions([newPosition()]);
    setNotice("Template saved.");
    await load();
  };

  const startEdit = async (t: Template) => {
    setNotice(null);
    const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(t.id)}`, {
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => ({}))) as {
      name?: string;
      positions?: Array<{ position_label: string; required_gender: GenderRule }>;
      position_labels?: string[];
    };
    if (!res.ok) {
      setNotice("Could not open that template.");
      return;
    }
    // Fall back to bare labels so a template written before migration 036 still opens.
    const positions =
      body.positions ?? (body.position_labels ?? []).map((label) => ({ position_label: label, required_gender: "any" as GenderRule }));
    setEditing(t.id);
    setEditName(body.name ?? t.name);
    setEditPositions(positions.length > 0 ? positions : [newPosition()]);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const n = validateTemplateName(editName);
    if (!n.ok) return setNotice(n.message);
    const validated = validateTemplatePositions(editPositions);
    if (!validated.ok) return setNotice(validated.message);

    setNotice(null);
    const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(editing)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n.name, position_labels: validated.positions }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(body.error ?? "Could not save the template.");
      return;
    }
    setEditing(null);
    setNotice("Template updated.");
    await load();
  };

  const remove = async (t: Template) => {
    if (!window.confirm(`Delete the template “${t.name}”? Saved plans are not affected.`)) return;
    setNotice(null);
    const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(t.id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      setNotice("Could not delete the template.");
      return;
    }
    setNotice(`Deleted “${t.name}”.`);
    await load();
  };

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-lg font-semibold sm:text-xl">Templates</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A template is the shape of a Mass: the positions, and who each position needs to be. The
          gender rule travels with the template, so a position that must be filled by a woman stays
          that requirement every week you reuse it.
        </p>
      </header>

      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-[var(--text-muted)]">{notice}</p> : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-medium">New template</h2>
        <div className="mt-3 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name (e.g. Sunday)"
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          />
          <PositionEditor
            positions={positions}
            onChange={setPositions}
            idPrefix="new"
          />
          <Button size="sm" onClick={() => void create()}>
            Save template
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Your templates</h2>
        {templates === null ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No templates yet.</p>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                {editing === t.id ? (
                  <div className="space-y-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
                    />
                    <PositionEditor
                      positions={editPositions}
                      onChange={setEditPositions}
                      idPrefix="edit"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void saveEdit()}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {t.name}
                      {typeof t.slot_count === "number" ? (
                        <span className="text-[var(--text-muted)]"> · {t.slot_count}</span>
                      ) : null}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => void startEdit(t)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(t)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One row per position: its name, and who can fill it. */
function PositionEditor({
  positions,
  onChange,
  idPrefix,
}: {
  positions: DraftPosition[];
  onChange: (next: DraftPosition[]) => void;
  idPrefix: string;
}) {
  const patch = (i: number, p: Partial<DraftPosition>) =>
    onChange(positions.map((pos, idx) => (idx === i ? { ...pos, ...p } : pos)));

  return (
    <div className="space-y-2">
      {positions.map((p, i) => (
        <div key={`${idPrefix}-${i}`} className="flex items-center gap-2">
          <input
            value={p.position_label}
            onChange={(e) => patch(i, { position_label: e.target.value })}
            placeholder="Position (e.g. Thurifer)"
            aria-label={`Position ${i + 1} name`}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          />
          <select
            value={p.required_gender}
            onChange={(e) => patch(i, { required_gender: e.target.value as GenderRule })}
            aria-label={`Who can fill ${p.position_label || `position ${i + 1}`}`}
            className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
          >
            {GENDER_RULES.map((g) => (
              <option key={g} value={g}>
                {GENDER_LABEL[g]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(positions.filter((_, idx) => idx !== i))}
            aria-label={`Remove ${p.position_label || `position ${i + 1}`}`}
          >
            ×
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...positions, newPosition()])}>
        Add position
      </Button>
      <p className="text-xs text-[var(--text-muted)]">
        &ldquo;Anyone&rdquo; means the random assigner may draw any active member for that position.
      </p>
    </div>
  );
}