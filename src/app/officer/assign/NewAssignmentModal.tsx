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
  blankMember,
  blankRow,
  draftDemand,
  draftFilled,
  draftUnassigned,
  seedRowsFromTemplate,
  validateDraft,
  type AssignmentDraft,
  type DraftMember,
  type DraftRow,
  type MassOption,
  type TemplateOption,
} from "@/lib/liturgy/assign-batch";
import { GENDER_RULES, type GenderRule, type TemplatePosition } from "@/lib/liturgy/rules";
import { isIsoDate } from "@/lib/time/church-time";

type TemplatePositions = { positions: TemplatePosition[] };

/**
 * The whole job, in one dialog: the date, the Mass, the lineup, and who is on it.
 *
 * This used to be four fields and nothing else, with the positions and the servers set on the page
 * underneath. Two sets of controls for one assignment is how somebody fills in the wrong one, and the
 * page underneath had a date and a Mass of its own that looked exactly like these. So all of it lives
 * here now, and the page has one job left: what has been saved.
 *
 * A position holds a *list* of servers rather than one. Two crucifixes, a thurifer and an assistant,
 * two candle bearers -- one label, several people, which is ordinary in a parish and used to be
 * something the sheet could not say. The roster table always allowed it; nothing above it did.
 *
 * Positions come from two places because a parish needs both. A template is the common case -- the same
 * lineup every Sunday. Adding one by hand is for the Mass that is different this week, and seeding from
 * a template never touches a row already on screen, so choosing a template after choosing servers
 * cannot silently un-book anybody.
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

  const chooseTemplate = useCallback(async (id: string) => {
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
  }, []);

  /**
   * Fill the slots that have nobody, and leave the ones that do alone.
   *
   * The draw is a server call rather than a loop in here because the rule it has to honour -- nobody
   * serving two Masses on the same Sunday -- needs to know who is already serving that date, which is
   * in the database and not in this dialog.
   *
   * The sheet is flattened to one entry per *person* before it goes, and the answer comes back in the
   * same order, so each drawn member lands in the slot it was drawn for. Matching by position label
   * instead would give both servers of a two-person position the same name, which is the exact case
   * this feature exists to serve.
   */
  const drawRandom = async () => {
    const named = rows.filter((r) => r.position_label.trim().length > 0);

    // Checked here, in the officer's words, rather than left to the schema. All three of these used
    // to be either a silently dead button or a raw "Invalid UUID" from the server, which is no answer
    // at all to somebody who has a date, a Mass and a template in front of them.
    if (!isIsoDate(sessionDate)) {
      setProblem("Choose the date of the Mass before drawing.");
      return;
    }
    if (!massId) {
      setProblem("Choose which Mass this is before drawing, so nobody already serving it is picked again.");
      return;
    }
    if (named.length === 0) {
      setProblem("Add at least one position before drawing.");
      return;
    }

    const wanted: Array<{ rowKey: string; slot: number; memberId: string; label: string; gender: GenderRule }> = [];
    for (const r of named) {
      r.members.forEach((m, i) =>
        wanted.push({
          rowKey: r.key,
          slot: i,
          memberId: m.member_id,
          label: r.position_label.trim(),
          gender: r.required_gender,
        }),
      );
    }
    const empty = wanted.filter((s) => !s.memberId).length;
    if (empty === 0) {
      setNote("Every slot already has a server. Clear one first if you want it drawn again.");
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
          rows: wanted.map((s) => ({
            position_label: s.label,
            required_gender: s.gender,
            ...(s.memberId ? { member_id: s.memberId } : {}),
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
      // Positional, because the server answers in the order it was asked. Slots the officer filled
      // come back unchanged, so writing over them with the same value cannot lose a hand-made choice.
      const drawn = new Map<string, DraftMember>();
      wanted.forEach((s, i) => {
        const hit = body.slots![i];
        if (hit?.member_id) {
          drawn.set(`${s.rowKey}#${s.slot}`, {
            member_id: hit.member_id,
            member_name: hit.member_name ?? "",
          });
        }
      });
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          members: r.members.map((m, i) => drawn.get(`${r.key}#${i}`) ?? m),
        })),
      );
      setNote(body.message ?? `Drew ${empty} server${empty === 1 ? "" : "s"}.`);
    } catch {
      setProblem("Could not reach the server, so nobody was drawn.");
    } finally {
      setDrawing(false);
    }
  };

  const patch = (key: string, next: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const patchMember = (key: string, index: number, next: Partial<DraftMember>) =>
    setRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, members: r.members.map((m, i) => (i === index ? { ...m, ...next } : m)) }
          : r,
      ),
    );

  /** Another person on the same position: two crucifixes, a thurifer and an assistant. */
  const addServer = (key: string) =>
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, members: [...r.members, blankMember()] } : r)),
    );

  /** Never takes a position below one slot. A position nobody is on yet is one not filled in, and
   *  removing the position itself is the separate Remove button's job. */
  const removeServer = (key: string, index: number) =>
    setRows((prev) =>
      prev.map((r) =>
        r.key === key && r.members.length > 1
          ? { ...r, members: r.members.filter((_, i) => i !== index) }
          : r,
      ),
    );

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
  const wanted = draftDemand(draft);
  const unassigned = draftUnassigned(draft);
  const named = rows.filter((r) => r.position_label.trim().length > 0).length;

  /**
   * What is still missing before a draw can run, said up front rather than after a dead press. A
   * template can be chosen without a Mass, which is exactly how somebody ends up with positions on
   * screen and a button that does nothing.
   */
  const blocker = !isIsoDate(sessionDate)
    ? "choose the date of the Mass"
    : !massId
      ? "choose which Mass this is"
      : named === 0
        ? "add a position"
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit this assignment" : "Add a new assignment"}</DialogTitle>
          <DialogDescription>
            Choose the Mass and the positions, then either draw the servers or pick them yourself. A
            position can have more than one server. Nothing is stored until you save.
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
              Brings in its positions with one server each. Anything already on screen is left alone, and
              you can still add positions of your own below.
            </span>
          </label>
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Positions and servers</h3>
            <div className="flex flex-wrap gap-2">
              {/* Never disabled for a missing prerequisite. A greyed-out button with the reason
                  hidden in a `title` is the same as no reason at all on a phone, and the officer
                  cannot see why the one control they came for is dead. Pressing it says which of the
                  three things is missing. */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void drawRandom()}
                disabled={drawing}
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

          {blocker ? (
            <p className="text-xs text-[var(--text-muted)]">To draw: {blocker}</p>
          ) : null}

          {rows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No positions yet. Choose a template above, or add one by hand.
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => {
                const short = r.members.filter((m) => !m.member_id).length;
                return (
                  <li
                    key={r.key}
                    className="rounded-xl border border-[var(--border)] p-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={r.position_label}
                        onChange={(e) => patch(r.key, { position_label: e.target.value })}
                        placeholder="Position"
                        aria-label="Position"
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
                      />
                      <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <span className="sr-only">
                          {r.position_label || "This position"} draws from
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      >
                        Remove position
                      </Button>
                    </div>

                    <ul className="mt-2 space-y-1">
                      {r.members.map((m, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <MemberCombobox
                              value={m.member_id ? { id: m.member_id, full_name: m.member_name } : null}
                              onChange={(hit) =>
                                patchMember(r.key, i, {
                                  member_id: hit?.id ?? "",
                                  member_name: hit?.full_name ?? "",
                                })
                              }
                              /* No visible label: the position is named at the top of this card and
                                 the number is in the placeholder, so a row per slot stays compact. */
                              label=""
                              id={`${r.key}-member-${i}`}
                              placeholder={
                                r.members.length > 1
                                  ? `${r.position_label || "Position"} ${i + 1} — search a member`
                                  : "Search a member…"
                              }
                            />
                          </div>
                          {r.members.length > 1 ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeServer(r.key, i)}
                              aria-label={`Remove server ${i + 1} from ${r.position_label || "this position"}`}
                            >
                              ×
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => addServer(r.key)}>
                        Add another server
                      </Button>
                      {r.members.length > 1 ? (
                        <span className="text-xs text-[var(--text-muted)]">
                          {r.members.length - short} of {r.members.length} filled for this position.
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {wanted > 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {filled} of {wanted} server slot{wanted === 1 ? "" : "s"} filled.
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