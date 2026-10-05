"use client";

/**
 * ATT-5: the roster.
 *
 * Built for one hand on a phone, at church, in a hurry. Everything here follows from
 * that: rows are tall enough to hit without looking, the whole row is the target
 * rather than a small checkbox, and nothing needs a second tap to confirm a single
 * person.
 *
 * State is local and optimistic. A tap flips the row immediately and sends one change
 * for one member; the server's answer is not waited on, because at 48 people the
 * round trip would make encoding feel like a laggy form. The counter is recalculated
 * from local state so it moves with the thumb, and the poll corrects it if the server
 * disagreed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { queueSummary, type QueueEntry } from "@/lib/attendance/retry-queue";
import { messageOf, readEnvelope } from "@/lib/api/client";
import { sortRoster, type SortMode } from "@/lib/attendance/roster-sort";
import {
  flushQueue,
  queueChange,
  queueFor,
  sendPresence,
  subscribeToConnection,
} from "@/features/attendance/ui/attendance-queue";

export type RosterEntry = {
  member_id: string;
  full_name: string;
  present: boolean;
  server_count: number;
};

type Props = {
  sessionId: string;
  roster: RosterEntry[];
  editable: boolean;
  notes: string | null;
  onNotesSave: (notes: string) => void;
  /** Set by the parent when the last note save failed, so the field can say so. */
  notesError?: string | null;
  notesSaved?: boolean;
  onRefresh: () => void;
  /** Bumped by the parent when something server-side changed the roster. */
  externalVersion?: number;
  banner?: React.ReactNode;
};

type Filter = "all" | "present" | "absent";
const UNDO_LIMIT = 20;
/** Matches the spec: the counter and rows refresh on focus and every 20s. */
const REFRESH_MS = 20_000;

export function Roster({
  sessionId,
  roster,
  editable,
  notes,
  onNotesSave,
  notesError = null,
  notesSaved = false,
  onRefresh,
  externalVersion,
  banner,
}: Props) {
  const [presentIds, setPresentIds] = useState<Set<string>>(
    () => new Set(roster.filter((r) => r.present).map((r) => r.member_id)),
  );
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("alphabetical");
  const [undoStack, setUndoStack] = useState<QueueEntry[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>(() => queueFor(sessionId));
  const [toast, setToast] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"mark_all" | "clear_all" | null>(null);
  const [noteDraft, setNoteDraft] = useState(notes ?? "");
  const notesTouched = useRef(false);

  // Server truth wins whenever a fresh roster arrives, but only if nothing is
  // pending, so a poll cannot undo a tap that has not been sent yet.
  useEffect(() => {
    if (queue.length) return;
    setPresentIds(new Set(roster.filter((r) => r.present).map((r) => r.member_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, externalVersion]);

  useEffect(() => {
    setNoteDraft(notes ?? "");
    notesTouched.current = false;
  }, [notes]);

  const nameFor = useCallback(
    (id: string) => roster.find((r) => r.member_id === id)?.full_name ?? "Someone",
    [roster],
  );

  const refreshQueue = useCallback(() => setQueue(queueFor(sessionId)), [sessionId]);

  const flush = useCallback(async () => {
    const result = await flushQueue(sessionId, nameFor);
    refreshQueue();
    if (result.rejected.length) {
      // Named, not counted. "1 change failed" leaves the secretary hunting; the name
      // lets them act on it.
      setToast({
        tone: "warn",
        text: `Could not save ${result.rejected
          .map((r) => r.memberName)
          .join(", ")}. ${result.rejected.find((r) => r.message)?.message ?? ""}`.trim(),
      });
    }
    onRefresh();
  }, [sessionId, nameFor, refreshQueue, onRefresh]);

  // Flush when the connection returns, and on focus.
  useEffect(() => {
    const unsubscribe = subscribeToConnection(() => void flush());
    const onFocus = () => void flush();
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [flush]);

  // And periodically, but only while the tab is visible. A hidden tab polling burns
  // a phone battery for nothing.
  useEffect(() => {
    if (!editable) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") onRefresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [editable, onRefresh]);

  const toggle = useCallback(
    async (member: RosterEntry) => {
      if (!editable) return;

      const wasPresent = presentIds.has(member.member_id);
      const next = !wasPresent;

      setPresentIds((prev) => {
        const nextSet = new Set(prev);
        if (next) nextSet.add(member.member_id);
        else nextSet.delete(member.member_id);
        return nextSet;
      });

      setUndoStack((prev) =>
        [
          ...prev,
          {
            seq: prev.length + 1,
            memberId: member.member_id,
            memberName: member.full_name,
            present: wasPresent,
            queuedAt: new Date().toISOString(),
          },
        ].slice(-UNDO_LIMIT),
      );

      const result = await sendPresence(sessionId, member.member_id, next);

      if (result.ok) return;

      if (result.reason === "rejected") {
        // Snap the row back and explain. Silently reverting would leave the secretary
        // tapping a screen that is not saving.
        setPresentIds((prev) => {
          const nextSet = new Set(prev);
          if (wasPresent) nextSet.add(member.member_id);
          else nextSet.delete(member.member_id);
          return nextSet;
        });
        setUndoStack((prev) => prev.slice(0, -1));
        setToast({ tone: "warn", text: result.message ?? `Could not save ${member.full_name}.` });
        return;
      }

      const { dropped } = queueChange(sessionId, member.member_id, member.full_name, next);
      refreshQueue();

      if (dropped.length) {
        // The cap was hit. Silence here means attendance goes missing without anyone
        // noticing, which is the one outcome this whole feature exists to prevent.
        setToast({
          tone: "warn",
          text: `Too many unsaved changes. ${dropped.map((d) => d.memberName).join(", ")} could not be queued — reopen the page and mark ${dropped.length === 1 ? "that person" : "those people"} again.`,
        });
      }
    },
    [editable, presentIds, sessionId, refreshQueue],
  );

  const undo = useCallback(() => {
    const last = undoStack[undoStack.length - 1];
    if (!last || !editable) return;

    setUndoStack((prev) => prev.slice(0, -1));
    setPresentIds((prev) => {
      const nextSet = new Set(prev);
      if (last.present) nextSet.add(last.memberId);
      else nextSet.delete(last.memberId);
      return nextSet;
    });

    const restored = last.present;
    void sendPresence(sessionId, last.memberId, restored).then((result) => {
      if (result.ok) return;
      if (result.reason === "rejected") {
        setToast({ tone: "warn", text: result.message ?? `Could not undo ${last.memberName}.` });
        return;
      }
      queueChange(sessionId, last.memberId, last.memberName, restored);
      refreshQueue();
    });
  }, [editable, undoStack, sessionId, refreshQueue]);

  const bulk = useCallback(
    async (op: "mark_all" | "clear_all") => {
      const ids = roster.map((r) => r.member_id);
      if (!ids.length) return;

      try {
        const res = await fetch(`/api/attendance/session/${sessionId}/records/set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ op }),
        });
        // The status has to be checked. The server refuses a bulk mark when the month is locked or
        // the Mass has not happened yet, and ignoring that made the whole roster flash present and
        // then snap back on refresh -- which reads as the app silently losing the change.
        if (!res.ok) {
          const env = await readEnvelope(res);
          setToast({ tone: "warn", text: messageOf(env, "Could not update the roster.") });
          return;
        }
      } catch {
        setToast({ tone: "warn", text: "Could not reach the server. Try again." });
        return;
      }

      setPresentIds(new Set(op === "mark_all" ? ids : []));
      setUndoStack([]);
      onRefresh();
    },
    [roster, sessionId, onRefresh],
  );

  const counts = useMemo(() => {
    const rows = roster.map((r) => ({
      id: r.member_id,
      fullName: r.full_name,
      serverCount: r.server_count,
      present: presentIds.has(r.member_id),
    }));
    const present = rows.filter((r) => r.present).length;
    return { rows, present, total: rows.length };
  }, [roster, presentIds]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    let filtered = counts.rows;

    if (filter === "present") filtered = filtered.filter((r) => r.present);
    if (filter === "absent") filtered = filtered.filter((r) => !r.present);
    if (needle) {
      filtered = filtered.filter((r) => r.fullName.toLowerCase().includes(needle));
    }

    return sortRoster(filtered, sortMode);
  }, [counts.rows, filter, sortMode, term]);

  const summary = queueSummary(queue);

  return (
    <div className="space-y-4">
      {banner}

      {/* Sticky so the counter stays visible while scrolling a 48-person roster. */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-semibold tabular-nums" aria-live="polite">
            <span className="text-[var(--brand)]">{counts.present}</span>
            <span className="text-[var(--text-muted)]"> / {counts.total} present</span>
          </p>
          <div className="flex items-center gap-2">
            {undoStack.length ? (
              <Button type="button" variant="outline" size="sm" onClick={undo} disabled={!editable}>
                <Undo2 aria-hidden />
                Undo
              </Button>
            ) : null}
            {editable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("mark_all")}>
                All
              </Button>
            ) : null}
            {editable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirm("clear_all")}
                disabled={!counts.present}
              >
                <X aria-hidden />
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {queue.length ? (
          <p
            role="status"
            className="mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm font-medium text-[var(--text-muted)]"
          >
            {summary.label}
          </p>
        ) : null}

        {toast ? (
          <p role="status" className="mt-2 rounded-lg bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {toast.text}
            <button
              type="button"
              className="ml-2 font-semibold underline"
              onClick={() => setToast(null)}
            >
              Dismiss
            </button>
          </p>
        ) : null}
      </div>

      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search names"
        aria-label="Search names"
        type="search"
      />

      <div className="flex flex-wrap gap-2">
        {(["all", "present", "absent"] as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            aria-pressed={filter === option}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium capitalize ${
              filter === option
                ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                : "border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSortMode((m) => (m === "alphabetical" ? "recent_servers" : "alphabetical"))}
          className="min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-medium text-[var(--text-muted)]"
        >
          {sortMode === "alphabetical" ? "A–Z" : "Recent servers"}
        </button>
      </div>

      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)]">
        {visible.map((row) => {
          const isPresent = presentIds.has(row.id);
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() =>
                  void toggle({
                    member_id: row.id,
                    full_name: row.fullName,
                    present: isPresent,
                    server_count: row.serverCount ?? 0,
                  })
                }
                disabled={!editable}
                aria-pressed={isPresent}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-base active:bg-[var(--surface-2)] disabled:opacity-60"
              >
                <span className="truncate">{row.fullName}</span>
                {/* The tick is not the only signal: the row also reads present/absent
                    through aria-pressed, so colour-blind users are not left guessing. */}
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${
                    isPresent
                      ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                      : "border-[var(--border)] text-transparent"
                  }`}
                >
                  <Check aria-hidden className="size-4" />
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
            {term.trim() ? "No names match that search." : "Nobody here."}
          </li>
        ) : null}
      </ul>

      <div>
        <label htmlFor="session-notes" className="text-sm font-medium text-[var(--text-muted)]">
          Notes
        </label>
        <Textarea
          id="session-notes"
          value={noteDraft}
          readOnly={!editable}
          disabled={!editable}
          // `aria-invalid` and the message below are wired together so a screen reader hears
          // that the note is not on the record, not just that a colour changed.
          aria-invalid={notesError ? true : undefined}
          aria-describedby={notesError ? "session-notes-status" : undefined}
          onChange={(e) => {
            notesTouched.current = true;
            setNoteDraft(e.target.value);
          }}
          // Saved on blur rather than on every keystroke: this is a phone on a slow
          // connection, and a request per character is how notes get half-sent.
          onBlur={() => {
            if (!notesTouched.current) return;
            notesTouched.current = false;
            onNotesSave(noteDraft);
          }}
          rows={3}
          className="mt-2"
        />
        {/*
          The save used to be fire-and-forget, so a rejected note looked saved and was not. The
          failure is stated here, under the field, rather than as an alert that would interrupt
          somebody in the middle of encoding attendance.
        */}
        {notesError ? (
          <p id="session-notes-status" role="alert" className="mt-2 text-sm text-[var(--danger)]">
            {notesError}
          </p>
        ) : notesSaved ? (
          <p id="session-notes-status" className="mt-2 text-sm text-[var(--text-muted)]">
            Note saved.
          </p>
        ) : null}
      </div>

      <BulkConfirm
        op={confirm}
        presentCount={counts.present}
        totalCount={counts.total}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const op = confirm;
          setConfirm(null);
          if (op) void bulk(op);
        }}
      />
    </div>
  );
}

function BulkConfirm({
  op,
  presentCount,
  totalCount,
  onCancel,
  onConfirm,
}: {
  op: "mark_all" | "clear_all" | null;
  presentCount: number;
  totalCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const markingAll = op === "mark_all";

  return (
    <AlertDialog open={op !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {markingAll ? `Mark all ${totalCount} present?` : `Clear all ${presentCount}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {markingAll
              ? "Everyone on the roster is marked present. You can still tap anyone off afterwards, or undo."
              : "Everyone is marked absent. You can still tap anyone back on afterwards."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {markingAll ? "Mark all present" : "Clear all"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
