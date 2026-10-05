"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { validateTemplateLabels, validateTemplateName } from "@/lib/liturgy/rules";

type Template = { id: string; name: string; slot_count?: number };

/**
 * Officer's template library.
 *
 * The planner's TemplateBar only ever creates from the positions currently on screen or deletes one
 * by name. This page is the lifecycle of a template on its own terms: a list, create from an explicit
 * label list, rename, replace the labels (edit), and delete. All of it goes through
 * `/api/officer/liturgy-templates`.
 */
export default function OfficerTemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create form.
  const [name, setName] = useState("");
  const [labelsText, setLabelsText] = useState("");

  // Inline edit (name and/or positions) for the one template being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLabels, setEditLabels] = useState("");

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
    const lines = labelsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const validated = validateTemplateLabels(lines);
    if (!validated.ok) return setNotice(validated.message);

    setNotice(null);
    const res = await fetch("/api/officer/liturgy-templates", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n.name, position_labels: validated.labels }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(body.error ?? "Could not create the template.");
      return;
    }
    setName("");
    setLabelsText("");
    setNotice("Template saved.");
    await load();
  };

  const startEdit = async (t: Template) => {
    setNotice(null);
    const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(t.id)}`, {
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => ({}))) as { name?: string; position_labels?: string[] };
    if (!res.ok) {
      setNotice("Could not open that template.");
      return;
    }
    setEditing(t.id);
    setEditName(body.name ?? t.name);
    setEditLabels((body.position_labels ?? []).join("\n"));
  };

  const saveEdit = async () => {
    if (!editing) return;
    const n = validateTemplateName(editName);
    if (!n.ok) return setNotice(n.message);
    const lines = editLabels
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const validated = validateTemplateLabels(lines);
    if (!validated.ok) return setNotice(validated.message);

    setNotice(null);
    const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(editing)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n.name, position_labels: validated.labels }),
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
          Reusable position lists for different kinds of Mass. Create, edit, rename, and delete the
          ones the planner can apply.
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
          <textarea
            value={labelsText}
            onChange={(e) => setLabelsText(e.target.value)}
            placeholder={"One position per line\nCrucifix\nThurifer\nLector"}
            rows={4}
            className="min-h-28 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
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
                    <textarea
                      value={editLabels}
                      onChange={(e) => setEditLabels(e.target.value)}
                      rows={4}
                      className="min-h-28 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
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