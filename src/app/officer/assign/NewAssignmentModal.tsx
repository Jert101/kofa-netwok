"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  activeMasses,
  validateDraft,
  type AssignmentDraft,
  type MassOption,
  type TemplateOption,
} from "@/lib/liturgy/assign-batch";

/**
 * "Add new assignment": one date, one Mass, one template, and the day its announcement goes away.
 *
 * A modal rather than more fields on the page because the page already has a date and a Mass of its
 * own for hand-editing one Mass, and two sets of those controls sitting next to each other is how
 * somebody fills in the wrong one. This one adds to a queue; the other edits a single roster.
 *
 * Nothing is stored from here. The officer can add several and save them together, which is the whole
 * point -- planning next month's Sundays is one action, not six.
 *
 * The Mass list is filtered to the active ones. A Mass the parish has switched off cannot be newly
 * assigned to, and offering it would produce a roster that appears in no calendar and is announced
 * to nobody who can act on it.
 */
export function NewAssignmentModal({
  open,
  onOpenChange,
  masses,
  templates,
  defaultDate,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  masses: readonly MassOption[];
  templates: readonly TemplateOption[];
  defaultDate: string;
  onAdd: (draft: AssignmentDraft) => void;
}) {
  const [sessionDate, setSessionDate] = useState(defaultDate);
  const [massId, setMassId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [announce, setAnnounce] = useState(true);
  const [deleteAt, setDeleteAt] = useState(defaultDate);
  const [problem, setProblem] = useState<string | null>(null);

  const active = useMemo(() => activeMasses(masses), [masses]);

  // Reopening starts from today's date and a clean sheet rather than from whatever the last one
  // happened to be holding: the common case is adding several Sundays in a row, and a stale date is
  // the mistake that is easiest to make and hardest to see.
  useEffect(() => {
    if (!open) return;
    setSessionDate(defaultDate);
    setDeleteAt(defaultDate);
    setMassId("");
    setTemplateId("");
    setAnnounce(true);
    setProblem(null);
  }, [open, defaultDate]);

  const draft: AssignmentDraft = {
    session_date: sessionDate,
    mass_id: massId,
    template_id: templateId,
    announce,
    announce_delete_at: deleteAt,
  };

  const submit = () => {
    const why = validateDraft(draft, { masses, templates });
    if (why) {
      setProblem(why);
      return;
    }
    onAdd(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a new assignment</DialogTitle>
          <DialogDescription>
            Pick the date and Mass, and the template that supplies the positions. Saving adds the
            servers for you — one draw per date, so nobody is given two Masses on the same Sunday.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Date</span>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => {
                setSessionDate(e.target.value);
                // Move the announcement's own date with it. Left behind, it would then sit before
                // the Mass and the save would be refused for a reason the officer did not cause.
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

          <label className="block">
            <span className="text-sm font-medium">Template</span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
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
              The template supplies the positions and which of them a man or a woman takes.
            </span>
          </label>

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
            Add to the list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}