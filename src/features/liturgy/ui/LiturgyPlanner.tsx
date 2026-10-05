"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PositionInput } from "./PositionInput";
import { AssigneePicker, type MemberHit } from "./AssigneePicker";
import { CopyFromDialog } from "./CopyFromDialog";
import { TemplateBar } from "./TemplateBar";
import {
  assigneeLabel,
  insertRow,
  isDirty,
  isRealRow,
  moveEditorRow,
  newRow,
  removeRow,
  rowsFromServer,
  toSlots,
  withGuest,
  withMember,
  withNoAssignee,
  type EditorRow,
} from "@/lib/liturgy/editor-rows";
import { countUnassigned, unassignedSummary, type LiturgyRow } from "@/lib/liturgy/rules";

/**
 * LIT-1: one editor, used for both planning ahead and serving today.
 *
 * The mode only changes the endpoint and the heading. Rows, ordering, warnings, and the leave guard
 * are identical, because a second implementation is a second set of bugs and the spec asks for one
 * component in both places.
 *
 * Warnings are computed from the unsaved rows rather than read back from the server, because LIT-3
 * wants them on the row while the officer is still typing. A warning that only appears after a
 * save is a warning about something already done.
 */

export type LiturgyTarget =
  | { kind: "planned"; sessionDate: string; massId: string }
  | { kind: "session"; sessionId: string };

export type LiturgyPlannerProps = {
  target: LiturgyTarget;
  /** Heading text, e.g. the Mass name. */
  title: string;
  /** Secondary line, e.g. "Sunday 26 October". */
  subtitle?: string;
  /**
   * Rows the page already has. When given, the editor starts on them instead of fetching, so the
   * officer does not watch a spinner for data the screen has been showing for a second.
   */
  initialRows?: Array<LiturgyRow & { member_name?: string | null; memberName?: string | null }>;
  /**
   * The version those rows came with. Optional, but when a page hands rows over without it the
   * optimistic-concurrency check cannot run: the editor sends `expected_version: null` and the
   * server can never see it, so the "someone else changed this" notice it is built around never
   * fires. The pages that already read rows now also read the version and pass both.
   */
  initialVersion?: string | null;
  onSaved?: () => void;
};

type LoadState = "loading" | "ready" | "error";

export function LiturgyPlanner({ target, title, subtitle, initialRows, initialVersion, onSaved }: LiturgyPlannerProps) {
  const seeded = useMemo(() => rowsFromServer(initialRows ?? []), [initialRows]);
  const [rows, setRows] = useState<EditorRow[]>(seeded);
  const [savedSnapshot, setSavedSnapshot] = useState<EditorRow[]>(seeded);
  const [version, setVersion] = useState<string | null>(initialVersion ?? null);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>(initialRows ? "ready" : "loading");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [serverWarnings, setServerWarnings] = useState<Warning[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const loadError = useRef<string | null>(null);

  const endpoint =
    target.kind === "planned"
      ? `/api/liturgy/planned?date=${encodeURIComponent(target.sessionDate)}&mass_id=${encodeURIComponent(target.massId)}`
      : `/api/liturgy/session/${encodeURIComponent(target.sessionId)}`;

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load the plan (${res.status}).`);
      const body = (await res.json()) as {
        rows?: Array<LiturgyRow & { member_name?: string | null; memberName?: string | null }>;
        version?: string;
        warnings?: ServerWarning[];
      };
      const next = rowsFromServer(body.rows ?? []);
      setRows(next);
      setSavedSnapshot(next);
      setVersion(body.version ?? null);
      setServerWarnings(toWarnings(body.warnings));
      setStatus(null);
      loadError.current = null;
      setState("ready");
    } catch (e) {
      loadError.current = e instanceof Error ? e.message : "Could not load the plan.";
      setState("error");
    }
  }, [endpoint]);

  useEffect(() => {
    if (initialRows) return;
    void load();
  }, [load, initialRows]);

  // The catalog only powers suggestions, so a failure degrades to free text rather than blocking
  // the officer from planning a Mass.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/liturgy/positions", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { labels?: string[] };
        if (!cancelled) setCatalog(body.labels ?? []);
      } catch {
        // Ignored on purpose; see above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => isDirty(rows, savedSnapshot), [rows, savedSnapshot]);

  // The leave guard. `beforeunload` covers closing the tab and a phone's back gesture. In-app
  // navigation is Next's client router, which does not fire `beforeunload`, so internal links are
  // intercepted in `guardInternalLinks` below.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      // Same page, download, or mailto: nothing is lost by leaving.
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || anchor.hasAttribute("download")) return;
      if (anchor.target === "_blank") return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const counts = useMemo(() => countUnassigned(toSlots(rows)), [rows]);
  const summaryText = unassignedSummary(counts);
  const totalRows = rows.filter(isRealRow).length;
  /**
   * Local warnings for what can be known on screen, plus the server's for what cannot.
   *
   * `double_booked` and `inactive_member` both need data this screen does not have — the other
   * Masses on the date, and the roster. They arrive with the load and after each save. Merging the
   * two lists into one summary means the officer reads "2 warnings" instead of learning there are
   * two different kinds of problem.
   */
  const warnings = useMemo(
    () => [...localWarnings(rows), ...serverWarnings],
    [rows, serverWarnings],
  );

  /** Read a row out of the current list by id, so edits never depend on array position. */
  const patchRow = (id: string, patch: (row: EditorRow) => Partial<EditorRow>) => {
    setRows((current) =>
      current.map((r) => {
        if (r.id !== id) return r;
        return { ...r, ...patch(r) };
      }),
    );
  };

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: toSlots(rows), expected_version: version }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        rows?: Array<LiturgyRow & { member_name?: string | null; memberName?: string | null }>;
        version?: string;
        updated_by_other_device?: boolean;
        new_labels?: string[];
        warnings?: ServerWarning[];
        error?: string;
      };

      if (!res.ok) {
        setStatus({ tone: "bad", text: body.error ?? "Could not save. Try again." });
        return;
      }

      if (typeof body.version === "string") setVersion(body.version);

      const next = rowsFromServer(body.rows ?? (toSlots(rows) as LiturgyRow[]));
      setRows(next);
      setSavedSnapshot(next);
      setServerWarnings(toWarnings(body.warnings));

      const added = body.new_labels ?? [];
      if (body.updated_by_other_device) {
        // Spec §8: the save wins, but say so. The officer has just overwritten a colleague, and
        // telling them is the only thing that makes that acceptable.
        setStatus({
          tone: "warn",
          text: "Saved, but someone else had changed this plan. Your version is the current one.",
        });
      } else if (added.length > 0) {
        setStatus({
          tone: "ok",
          text: `Saved. Added ${added.length} new position${added.length === 1 ? "" : "s"} to the catalog.`,
        });
      } else {
        setStatus({ tone: "ok", text: "Saved." });
      }

      onSaved?.();
    } catch {
      setStatus({ tone: "bad", text: "Could not reach the server. Your changes are still here." });
    } finally {
      setSaving(false);
    }
  };

  const addRow = (afterId: string | null) => {
    const id = `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setRows((r) => insertRow(r, afterId, newRow(id)));
  };

  if (state === "loading") {
    return <p className="py-6 text-center text-sm text-[var(--text-muted)]">Loading the plan…</p>;
  }

  if (state === "error") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm text-[var(--danger)]">{loadError.current}</p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle ? <p className="text-sm text-[var(--text-muted)]">{subtitle}</p> : null}
          <p className="text-sm text-[var(--text-muted)]">
            {summaryText}
            {warnings.length > 0 ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setCopyOpen(true)}>
            Copy from…
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {status ? (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 text-sm ${
            status.tone === "bad"
              ? "text-[var(--danger)]"
              : status.tone === "warn"
                ? "bg-[var(--brand-soft)] text-[var(--text)]"
                : "text-[var(--text-muted)]"
          }`}
        >
          {status.text}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--brand-soft)] p-3 text-sm">
          {warnings.map((w, i) => (
            <li key={`${w.rowId ?? "w"}-${i}`}>{w.text}</li>
          ))}
        </ul>
      ) : null}

      <TemplateBar
        currentLabels={rows.filter(isRealRow).map((r) => r.position_label)}
        onApply={(labels) => {
          // Spec §LIT-4: loading a template replaces the rows and clears the assignees. That is
          // destructive, so it is confirmed here rather than inside TemplateBar, which cannot know
          // whether there is anything worth losing.
          const filled = rows.filter((r) => assigneeLabel(r).length > 0).length;
          const question =
            filled > 0
              ? `Loading a template replaces all ${rows.length} positions and clears the ${filled} name${
                  filled === 1 ? "" : "s"
                } you have typed. Continue?`
              : "Loading a template replaces the positions on screen. Continue?";
          if (typeof window !== "undefined" && !window.confirm(question)) return;
          const stamp = Date.now().toString(36);
          setRows(labels.map((label, i) => ({ ...newRow(`tpl-${stamp}-${i}`), position_label: label })));
          setStatus({ tone: "ok", text: "Template loaded. Assign names, then save." });
        }}
      />

      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragIndex;
              setDragIndex(null);
              if (from === null) return;
              setRows((r) => moveEditorRow(r, from, index));
            }}
          >
            <div className="flex items-start gap-2">
              <button
                type="button"
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragEnd={() => setDragIndex(null)}
                aria-label={`Reorder ${row.position_label || "this position"}. Use the arrow buttons if dragging is not convenient.`}
                className="mt-1.5 cursor-grab select-none text-lg leading-none text-[var(--text-muted)]"
              >
                ⠿
              </button>

              <div className="min-w-0 flex-1 space-y-2">
                <PositionInput
                  row={row}
                  catalog={catalog}
                  onChange={(label) => patchRow(row.id, () => ({ position_label: label }))}
                />
                <AssigneePicker
                  row={row}
                  positionLabel={row.position_label}
                  onPickMember={(m: MemberHit) =>
                    patchRow(row.id, (r) => withMember(r, { id: m.id, name: m.full_name }))
                  }
                  onTypeGuest={(name) => patchRow(row.id, (r) => withGuest(r, name))}
                  onClear={() => patchRow(row.id, (r) => withNoAssignee(r))}
                />
              </div>

              <div className="flex shrink-0 flex-col">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${row.position_label || "this position"} up`}
                  disabled={index === 0}
                  onClick={() => setRows((r) => moveEditorRow(r, index, index - 1))}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${row.position_label || "this position"} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => setRows((r) => moveEditorRow(r, index, index + 1))}
                >
                  ↓
                </Button>
              </div>
            </div>

            <div className="mt-1 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((r) => removeRow(r, row.id))}
                aria-label={`Remove ${row.position_label || "this row"}`}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={() => addRow(rows[rows.length - 1]?.id ?? null)}>
          Add position
        </Button>
        <p className="text-xs text-[var(--text-muted)]">
          {totalRows} position{totalRows === 1 ? "" : "s"}
        </p>
      </div>

      {target.kind === "planned" ? (
        <a
          href={`/api/liturgy/pdf?date=${encodeURIComponent(target.sessionDate)}`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Download the printable sheet
        </a>
      ) : null}

      <CopyFromDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        target={target}
        onApplied={(copied) => {
          const stamp = Date.now().toString(36);
          setRows(
            copied.map((s, i) => ({
              id: `copy-${stamp}-${i}`,
              position_label: s.position_label,
              member_id: s.member_id,
              member_name: s.member_name ?? null,
              free_text: s.free_text,
              assignee: s.member_id ? "member" : s.free_text ? "guest" : "empty",
            })),
          );
          setStatus({ tone: "ok", text: "Copied in. Review it, then save." });
        }}
      />
    </div>
  );
}

// ======================================================================================
// Inline warnings
// ======================================================================================

type Warning = { text: string; rowId: string };

/** The server's conflict shape, minus the fields this screen does not use. */
type ServerWarning = {
  kind: "duplicate_in_mass" | "double_booked" | "inactive_member";
  memberName: string;
  positionLabel: string;
  detail: string;
};

/**
 * Turn the server's conflicts into sentences.
 *
 * The server already composes `detail` for this, including the other Mass and its time when it is
 * known, so it is passed through rather than rebuilt here. Rebuilding it in the client would be a
 * second place for the wording to drift, and the wording is the part the officer reads.
 */
function toWarnings(warnings: ServerWarning[] | undefined): Warning[] {
  return (warnings ?? []).map((w) => ({
    rowId: `server-${w.kind}-${w.positionLabel}-${w.memberName}`,
    text: `${w.memberName}: ${w.detail}`,
  }));
}

/**
 * Duplicate-member warnings for the rows on screen.
 *
 * Only what can be known without the database. `double_booked` needs the other Masses on the same
 * date, so that one comes back from the server's warnings after the save rather than being
 * reimplemented here and guessed at.
 */
function localWarnings(rows: EditorRow[]): Warning[] {
  const held = new Map<string, EditorRow[]>();
  for (const row of rows) {
    if (row.assignee !== "member" || !row.member_id) continue;
    const list = held.get(row.member_id) ?? [];
    list.push(row);
    held.set(row.member_id, list);
  }

  const out: Warning[] = [];
  for (const list of held.values()) {
    if (list.length < 2) continue;
    const labels = list.map((r) => r.position_label || "an unnamed position");
    const name = list[0].member_name ?? "This member";
    // The row to flag is the second one, not the first: the first is probably deliberate and the
    // second is the one that was added by mistake.
    out.push({
      rowId: list[1].id,
      text: `${name} is listed ${labels.length} times in this Mass (${labels.join(", ")}).`,
    });
  }
  return out;
}
