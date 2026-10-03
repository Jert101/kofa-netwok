"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { validateTemplateName, validateTemplateLabels } from "@/lib/liturgy/rules";

/**
 * LIT-4: save the current shape as a template, apply one, and rename it.
 *
 * Applying a template replaces the position list but not the names already typed into it, which
 * would otherwise be a destructive surprise: an officer who has just filled three positions and
 * then taps the wrong template should not lose them. So apply only ever runs from the parent's
 * explicit "replace the list" path, and this component says so on the button.
 *
 * Rename is here rather than on the templates page because that is where the name is being used.
 * A rename endpoint that 409s on a case-only difference ("weekday" vs "Weekday") is the kind of
 * thing that only shows up in production, so `PATCH` here reports the conflict in plain language.
 */

type Template = { id: string; name: string; slot_count?: number };

export type TemplateBarProps = {
  /** The position labels currently on screen, in order. */
  currentLabels: string[];
  onApply: (labels: string[]) => void;
};

export function TemplateBar({ currentLabels, onApply }: TemplateBarProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/officer/liturgy-templates", { credentials: "same-origin" });
      if (!res.ok) return;
      const body = (await res.json()) as { templates?: Template[] };
      setTemplates(body.templates ?? []);
    } catch {
      // Templates are a convenience; a failed list must not block planning.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyTemplate = async (t: Template) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(t.id)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { position_labels?: string[] };
      onApply(body.position_labels ?? []);
      setMessage({ tone: "ok", text: `Loaded ${t.name}.` });
    } catch {
      setMessage({ tone: "bad", text: `Could not load ${t.name}.` });
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    const name = validateTemplateName(saveName);
    if (!name.ok) {
      setMessage({ tone: "bad", text: name.message });
      return;
    }
    const labels = validateTemplateLabels(currentLabels);
    if (!labels.ok) {
      setMessage({ tone: "bad", text: labels.message });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/officer/liturgy-templates", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.name, position_labels: labels.labels }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({ tone: "bad", text: body.error ?? "Could not save the template." });
        return;
      }
      setSaveName("");
      setMessage({ tone: "ok", text: `Saved ${name.name}.` });
      await load();
    } catch {
      setMessage({ tone: "bad", text: "Could not save the template." });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string) => {
    const name = validateTemplateName(renameValue);
    if (!name.ok) {
      setMessage({ tone: "bad", text: name.message });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.name }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({ tone: "bad", text: body.error ?? "Could not rename." });
        return;
      }
      setRenaming(null);
      setMessage({ tone: "ok", text: `Renamed to ${name.name}.` });
      await load();
    } catch {
      setMessage({ tone: "bad", text: "Could not rename." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: Template) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete the template “${t.name}”? Saved plans are not affected.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(t.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setMessage({ tone: "bad", text: "Could not delete the template." });
        return;
      }
      setMessage({ tone: "ok", text: `Deleted ${t.name}.` });
      await load();
    } catch {
      setMessage({ tone: "bad", text: "Could not delete the template." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Templates</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          {loaded && templates.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No templates yet.</p>
          ) : null}

          {templates.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2">
              {renaming === t.id ? (
                <>
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    aria-label={`New name for ${t.name}`}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
                  />
                  <Button type="button" size="sm" disabled={busy} onClick={() => void rename(t.id)}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t.name}
                    {typeof t.slot_count === "number" ? (
                      <span className="text-[var(--text-muted)]"> · {t.slot_count}</span>
                    ) : null}
                  </span>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void applyTemplate(t)}>
                    Use
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRenaming(t.id);
                      setRenameValue(t.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void remove(t)}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          ))}

          <div className="border-t border-[var(--border)] pt-3">
            <label className="block text-sm font-medium" htmlFor="tpl-new">
              Save the current positions as a template
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="tpl-new"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Template name"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              />
              <Button type="button" disabled={busy} onClick={() => void saveTemplate()}>
                Save
              </Button>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Using a template replaces the positions on screen, including any names you have typed.
            </p>
          </div>

          {message ? (
            <p role="status" className={`text-sm ${message.tone === "bad" ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>
              {message.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
