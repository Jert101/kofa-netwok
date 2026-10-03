"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatLongDay } from "@/lib/liturgy/sheet";
import type { LiturgySlotInput } from "@/lib/liturgy/rules";

/**
 * LIT-2: copy another Mass's lineup into this one.
 *
 * Three decisions worth naming, because they are the difference between this being usable at 7am
 * and being a liability:
 *
 * 1. It is a *preview*. The dialog shows what would arrive before anything is written, because the
 *    copy drops inactive members and the officer has to see who those are before they agree.
 * 2. Positions-only is the default. "Copy last Sunday's shape" and "copy last Sunday's people" are
 *    different requests, and defaulting to the destructive one is how you end up with last
 *    Sunday's readers assigned to Thursday's Mass by accident.
 * 3. Nothing is written by this dialog. It hands rows back to the parent, which puts them on
 *    screen as unsaved edits. That way the officer sees the result, adjusts it, and one Save
 *    produces one audit row describing what they actually did.
 *
 * The date defaults to the previous weekend, because the overwhelmingly common case is "same as
 * last week".
 */

export type CopyTarget =
  | { kind: "planned"; sessionDate: string; massId: string }
  | { kind: "session"; sessionId: string };

type Mass = { id: string; name: string };

type PreviewRow = LiturgySlotInput & { member_name?: string | null };

export type CopyFromDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: CopyTarget;
  onApplied: (rows: PreviewRow[]) => void;
};

function toTargetRef(t: CopyTarget): Record<string, string> {
  return t.kind === "session" ? { session_id: t.sessionId } : { session_date: t.sessionDate, mass_id: t.massId };
}

function previousWeekend(from: string): string {
  const base = new Date(`${from}T00:00:00`);
  if (Number.isNaN(base.getTime())) return from;
  const dow = base.getDay();
  const back = dow === 0 ? 7 : dow;
  base.setDate(base.getDate() - back);
  return base.toISOString().slice(0, 10);
}

export function CopyFromDialog({ open, onOpenChange, target, onApplied }: CopyFromDialogProps) {
  const [masses, setMasses] = useState<Mass[]>([]);
  const [date, setDate] = useState("");
  const [massId, setMassId] = useState("");
  const [includeMembers, setIncludeMembers] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open so the previous Mass's preview is never one tap away from this one's save.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setDropped([]);
    setNotice(null);
    setError(null);
    setIncludeMembers(false);
    setDate(previousWeekend("session_date" in toTargetRef(target) ? toTargetRef(target).session_date : new Date().toISOString().slice(0, 10)));
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/masses", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: { masses?: Mass[] } };
        if (cancelled) return;
        // Enveloped response: the array is under `data`. See admin/masses for why this is spelled out.
        const list = (body.data?.masses ?? []).filter((m) => m && m.id);
        setMasses(list);
        // Default to the Mass being planned when it is in the catalog: copying "this Mass, last
        // week" is the common case, and defaulting to the first Mass in the list is a coin flip.
        const own = toTargetRef(target);
        const ownMass = "mass_id" in own ? own.mass_id : null;
        setMassId((current) => (current && list.some((m) => m.id === current) ? current : (ownMass && list.some((m) => m.id === ownMass) ? ownMass : (list[0]?.id ?? ""))));
      } catch {
        // The date and Mass fields still work; a failed catalog just means picking from what loads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  const own = toTargetRef(target);
  const ownMassId = "mass_id" in own ? own.mass_id : null;
  const ownDate = "session_date" in own ? own.session_date : new Date().toISOString().slice(0, 10);

  const runPreview = useCallback(
    async (over?: { date?: string; massId?: string }) => {
      // Overrides rather than reading state, because "Same Mass last week" sets the fields and
      // immediately previews. Calling with the closure's `date` would preview the old one, and the
      // officer would be looking at last week's list for last week.
      const fromDate = over?.date ?? date;
      const fromMass = over?.massId ?? massId;
      setBusy(true);
      setError(null);
      setPreview(null);
      try {
        const res = await fetch("/api/liturgy/copy", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: { session_date: fromDate, mass_id: fromMass },
            to: toTargetRef(target),
            include_members: includeMembers,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          rows?: PreviewRow[];
          dropped_inactive?: string[];
          nothing_to_copy?: boolean;
          message?: string | null;
          error?: string;
        };
        if (!res.ok) {
          setError(body.error ?? "Could not read that plan.");
          return;
        }
        if (body.nothing_to_copy) {
          setNotice("There is no plan saved for that date yet.");
          return;
        }
        setPreview(body.rows ?? []);
        setDropped(body.dropped_inactive ?? []);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [date, massId, includeMembers, target],
  );

  // The spec asks for "Same Mass last week" as a named option, not just a sensible default: one tap
  // to the common case, then the date picker for when it is not the common case.
  const sameMassLastWeek = () => {
    const lastWeek = previousWeekend(ownDate);
    const mass = ownMassId ?? massId;
    setDate(lastWeek);
    setMassId(mass);
    setNotice(null);
    setError(null);
    void runPreview({ date: lastWeek, massId: mass });
  };

  const apply = () => {
    if (!preview) return;
    onApplied(preview);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy from another Mass</DialogTitle>
          <DialogDescription>
            Copying replaces the positions currently on screen once you confirm. Nothing is saved
            until you press Save afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button type="button" variant="outline" disabled={busy || !ownMassId} onClick={sameMassLastWeek}>
            Same Mass last week
          </Button>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setPreview(null);
                }}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              />
              {date ? <span className="mt-1 block text-xs text-[var(--text-muted)]">{formatLongDay(date)}</span> : null}
            </label>

            <label className="block text-sm">
              <span className="font-medium">Mass</span>
              <select
                value={massId}
                onChange={(e) => {
                  setMassId(e.target.value);
                  setPreview(null);
                }}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              >
                {masses.length === 0 ? <option value="">Loading…</option> : null}
                {masses.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-[var(--border)] p-3 text-sm">
            <input
              type="checkbox"
              checked={includeMembers}
              onChange={(e) => {
                setIncludeMembers(e.target.checked);
                setPreview(null);
              }}
              className="mt-0.5"
            />
            <span>
              Bring the names too
              <span className="block text-xs text-[var(--text-muted)]">
                Off copies the positions only. Members who are no longer active are left out either
                way, and listed before you confirm.
              </span>
            </span>
          </label>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          {notice ? <p className="text-sm text-[var(--text-muted)]">{notice}</p> : null}

          {preview ? (
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-sm font-medium">
                {preview.length} position{preview.length === 1 ? "" : "s"} will be copied
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-[var(--text-muted)]">
                {preview.map((r, i) => (
                  <li key={`${r.position_label}-${i}`} className="truncate">
                    {r.position_label}
                    {r.member_id || r.free_text ? (
                      <span className="text-[var(--text)]">
                        {" — "}
                        {r.member_name ?? r.free_text ?? "a member"}
                      </span>
                    ) : (
                      <span> — unassigned</span>
                    )}
                  </li>
                ))}
              </ul>
              {dropped.length > 0 ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Not copied, because they are no longer active: {dropped.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {preview ? (
            <Button type="button" onClick={apply}>
              Copy these in
            </Button>
          ) : (
            <Button type="button" disabled={busy || !date || !massId} onClick={() => void runPreview()}>
              {busy ? "Checking…" : "Preview"}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
