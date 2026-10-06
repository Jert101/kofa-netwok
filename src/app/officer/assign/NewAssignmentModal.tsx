"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberCombobox } from "@/components/MemberCombobox";
import {
  activeMasses,
  blankRow,
  draftFilled,
  draftUnassigned,
  seedRowsFromTemplate,
  validateDraft,
  type AssignmentDraft,
  type DraftRow,
  type MassOption,
  type TemplateOption,
} from "@/lib/liturgy/assign-batch";
import { GENDER_RULES, type GenderRule, type TemplatePosition } from "@/lib/liturgy/rules";

type TemplatePositions = { positions: TemplatePosition[] };

/**
 * The whole job, in one dialog: the date, the Mass, the lineup, and who is on it.
 *
 * This used to be four fields and nothing else, with the positions and the servers set on the page
 * underneath. Two sets of controls for one assignment is how somebody fills in the wrong one, and the
 * page underneath had a date and a Mass of its own that looked exactly like these. So all of it lives
 * here now, and the page has one job left: what has been saved.
 *
 * Positions come from two places because a parish needs both. A template is the common case -- the same
 * lineup every Sunday. Adding a position by hand is for the Mass that is different this week, and
 * seeding from a template never touches a row already on screen, so picking one after choosing servers
 * cannot silently un-book anybody.
 *
 * `draft` turns the same dialog into an edit, of a queued entry or of a saved assignment, which is
 * why add and edit are one component rather than two that drift apart.
 */
export function NewAssignmentModal({
  open,
  onOpenChange,
  masses,
  templates,
  defaultDate,
  /** An entry already on the queue or already saved, when this is an edit rather than an add. */
  draft: editing = null,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  masses: readonly MassOption[];
  templates: readonly TemplateOption[];
  defaultDate: string;
  draft?: AssignmentDraft | null;
  onSubmit: (draft: AssignmentDraft) => void;
}) {
  const [sessionDate, setSessionDate] = useState(defaultDate);
  const [massId, setMassId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [announce, setAnnounce] = useState(true);
  const [deleteAt, setDeleteAt] = useState(defaultDate);
  const [problem, setProblem] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const active = useMemo(() => activeMasses(masses), [masses]);

  // Reopening starts from today and a clean sheet rather than from whatever the last one happened to
  // be holding: the common case is adding several Sundays in a row, and a stale date is the mistake
  // that is easiest to make and hardest to see. An edit opens on what it is editing.
  useEffect(() => {
    if (!open) return;
    setSessionDate(editing?.session_date ?? defaultDate);
    setDeleteAt(editing?.announce_delete_at ?? defaultDate);
    setMassId(editing?.mass_id ?? "");
    setTemplateId(editing?.template_id ?? "");
    setRows(editing?.rows ?? []);
    setAnnounce(editing ? editing.announce : true);
    setProblem(null);
    setNote(null);
  }, [open, defaultDate, editing]);

  const chooseTemplate = useCallback(
    async (id: string) => {
      setTemplateId(id);
      if (!id) return;
      try {
        const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(id)}`, {
          credentials: "same-origin",
        });
        const body = (await res.json().catch(() => ({}))) as TemplatePositions;
        if (!res.ok) {
          setNote("Could not load that template.");
          return;
        }
        const positions = body.positions ?? [];
        setRows((prev) => seedRowsFromTemplate(prev, positions));
        setNote(
          `Added ${positions.length} position${positions.length === 1 ? "" : "s"} from the template. Anything already on screen was left alone.`,
        );
      } catch {
        setNote("Could not load that template.");
      }
    },
    [],
  );

  /**
   * Fill the positions that have nobody, and leave the ones that do alone.
   *
   * The draw is a server call rather than a loop in here because the rule it has to honour -- nobody
   * serving two Masses on the same Sunday -- needs to know who is already assigned that date, which is
   * in the database and not in this dialog. The result comes back in the order the positions are
   * listed, so the lineup the officer arranged is the lineup they get.
   */
  const drawRandom = async () => {
    const named = rows.filter((r) => r.position_label.trim().length > 0);
    if (named.length === 0) {
      setProblem("Add at least one position before drawing.");
      return;
    }
    const empty = named.filter((r) => !r.member_id).length;
    if (empty === 0) {
      setNote("Every position already has a server. Clear one first if you want it drawn again.");
      return;
    }

    setDrawing(true);
    setProblem(null);
    setNote(null);
    try {
      const res = await fetch("/api/officer/assign/draw", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_date: sessionDate,
          mass_id: massId,
          rows: named.map((r) => ({
            position_label: r.position_label.trim(),
            required_gender: r.required_gender,
            ...(r.member_id ? { member_id: r.member_id } : {}),
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string | null;
        slots?: Array<{ position_label: string; member_id: string; member_name: string | null }>;
      };
      if (!res.ok || !body.slots) {
        setProblem(body.error ?? "Could not draw the servers.");
        return;
      }
      // A queue per position rather than a lookup by name, because a parish may have two rows for one
      // position -- two candles, say -- and a lookup would hand both of them the same person.
      const queue = new Map<string, typeof body.slots>();
      for (const s of body.slots) {
        const list = queue.get(s.position_label) ?? [];
        list.push(s);
        queue.set(s.position_label, list);
      }
      setRows((prev) =>
        prev.map((r) => {
          const label = r.position_label.trim();
          // Blank rows and rows the officer filled themselves are untouched: drawing twice fills the
          // gaps rather than throwing away a choice somebody made by hand.
          if (label.length === 0 || r.member_id) return r;
          const hit = queue.get(label)?.shift();
          if (!hit?.member_id) return r;
          return { ...r, member_id: hit.member_id, member_name: hit.member_name ?? "" };
        }),
      );
      setNote(body.message ?? `Drew a server for ${empty} position${empty === 1 ? "" : "s"}.`);
    } catch {
      setProblem("Could not reach the server, so nobody was drawn.");
    } finally {
      setDrawing(false);
    }
  };

  const patch = (key: string, next: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const draft: AssignmentDraft = {
    session_date: sessionDate,
    mass_id: massId,
    template_id: templateId,
    announce,
    announce_delete_at: deleteAt,
    rows,
  };

  const submit = () => {
    const why = validateDraft(draft, { masses, templates });
    if (why) {
      setProblem(why);
      return;
    }
    onSubmit(draft);
    onOpenChange(false);
  };

  const filled = draftFilled(draft);
  const unassigned = draftUnassigned(draft);
  const named = rows.filter((r) => r.position_label.trim().length > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit this assignment" : "Add a new assignment"}</DialogTitle>
          <DialogDescription>
            Choose the Mass and the positions, then either draw the servers or pick them yourself.
            Nothing is stored until you save.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Date</span>
              <input
                type="date"
                value={sessionDate}
                onChange={(e) => {
                  setSessionDate(e.target.value);
                  // Move the announcement's own date with it. Left behind, it would sit before the
                  // Mass and the save would be refused for a reason the officer did not cause.
                  if (!deleteAt || deleteAt < e.target.value) setDeleteAt(e.target.value);
                }}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Mass</span>
              <select
                value={massId}
                onChange={(e) => setMassId(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              >
                <option value="">Choose a Mass…</option>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {active.length === 0 ? (
                <p className="mt-1 text-xs text-[var(--danger)]">
                  You have no active Mass to assign. Switch one on from Mass settings first.
                </p>
              ) : null}
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">Template</span>
            <select
              value={templateId}
              onChange={(e) => void chooseTemplate(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              Brings in its positions. Anything already on screen is left alone, and you can still add
              positions of your own below.
            </span>
          </label>
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Positions and servers</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void drawRandom()}
                disabled={drawing || !massId || named === 0}
                title={!massId ? "Choose a Mass first" : undefined}
              >
                {drawing ? "Drawing…" : "Draw randomly"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRows((prev) => [...prev, blankRow()])}>
                Add position
              </Button>
              {rows.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setRows([])}>
                  Clear all
                </Button>
              ) : null}
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No positions yet. Choose a template above, or add one by hand.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2">
                  <input
                    value={r.position_label}
                    onChange={(e) => patch(r.key, { position_label: e.target.value })}
                    placeholder="Position"
                    aria-label="Position"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
                  />
                  <div className="min-w-0 flex-[2]">
                    <MemberCombobox
                      value={r.member_id ? { id: r.member_id, full_name: r.member_name } : null}
                      onChange={(m) =>
                        patch(r.key, { member_id: m?.id ?? "", member_name: m?.full_name ?? "" })
                      }
                      label="Server"
                    />
                  </div>
                  {!r.member_id ? (
                    <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <span className="sr-only">
                        {r.position_label || "This position"} should be drawn from
                      </span>
                      <select
                        value={r.required_gender}
                        onChange={(e) =>
                          patch(r.key, { required_gender: e.target.value as GenderRule })
                        }
                        aria-label={`Who a random draw may pick for ${r.position_label || "this position"}`}
                        className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
                      >
                        {GENDER_RULES.map((g) => (
                          <option key={g} value={g}>
                            {g === "any" ? "Anyone" : g === "male" ? "Male" : "Female"}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {named > 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {filled} of {named} position{named === 1 ? "" : "s"} filled.
              {unassigned > 0
                ? ` ${unassigned} with nobody yet — only the filled ones are saved.`
                : ""}
            </p>
          ) : null}

          {note ? <p className="text-xs text-[var(--text-muted)]">{note}</p> : null}
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-2 rounded-xl border border-[var(--border)] p-3 text-sm">
            <input
              type="checkbox"
              checked={announce}
              onChange={(e) => setAnnounce(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Announce this assignment</span>
              <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                Puts the whole roster in the announcements feed and sends a notification naming every
                server. Leave it unticked to store the assignment quietly.
              </span>
            </span>
          </label>

          {announce ? (
            <label className="block">
              <span className="text-sm font-medium">Delete the announcement on</span>
              <input
                type="date"
                value={deleteAt}
                min={sessionDate || undefined}
                onChange={(e) => setDeleteAt(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              />
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                The announcement stays in the feed through this day and is removed the next day.
              </span>
            </label>
          ) : null}

          {problem ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {problem}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={active.length === 0 || templates.length === 0}>
            {editing ? "Save the change" : "Add to the list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}