"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { assigneeLabel, type EditorRow } from "@/lib/liturgy/editor-rows";

/**
 * LIT-1's assignee picker: search the roster, or type a guest's name.
 *
 * The 180 ms debounce is in the spec and is also what keeps this usable on a phone at the end of
 * Mass — a request per keystroke on a shared connection is how a picker ends up feeling broken.
 * The repo's other search box (`PaymentLookupPage`) uses 250 ms and guards with a `cancelled` flag;
 * this follows the 180 ms the spec names and keeps the same cancellation, because a response that
 * lands after the officer has typed three more letters is worse than no response at all.
 */

export type MemberHit = { id: string; full_name: string };

const DEBOUNCE_MS = 180;
const MAX_HITS = 10;

export type AssigneePickerProps = {
  row: EditorRow;
  onPickMember: (member: MemberHit) => void;
  onTypeGuest: (name: string) => void;
  onClear: () => void;
  /** Labels this row already appears with, used for the row's accessible name. */
  positionLabel: string;
};

export function AssigneePicker({
  row,
  onPickMember,
  onTypeGuest,
  onClear,
  positionLabel,
}: AssigneePickerProps) {
  const [mode, setMode] = useState<"member" | "guest">(row.assignee === "guest" ? "guest" : "member");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<MemberHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // One in-flight search per row. The flag is set on cleanup, which runs both when the term
  // changes and when the row unmounts mid-flight.
  useEffect(() => {
    const q = term.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}&limit=${MAX_HITS}`, {
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (!cancelled) setHits([]);
          return;
        }
        const body = (await res.json()) as { members?: MemberHit[] };
        if (!cancelled) setHits((body.members ?? []).slice(0, MAX_HITS));
      } catch {
        // A failed search is an empty list, not an error screen: the officer can still type a
        // guest name, and a roster failure is not something they can act on mid-Mass.
        if (!cancelled) setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  // Close the results when the officer taps anywhere else. Without this the list stays open over
  // the next row, which on a phone is indistinguishable from the row underneath being occupied.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // Switching picker resets the query. Keeping "Rey" in the box after choosing the guest picker
  // reads as a filter that is still running against something.
  const switchMode = (next: "member" | "guest") => {
    setMode(next);
    setTerm("");
    setHits([]);
    setOpen(false);
  };

  const chosen = assigneeLabel(row);

  if (chosen.length > 0) {
    return (
      <div className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
        <span className="min-w-0 flex-1 truncate text-base">{chosen}</span>
        {row.assignee === "guest" ? (
          <span className="shrink-0 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
            Guest
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onClear} aria-label={`Clear who is doing ${positionLabel || "this position"}`}>
          Clear
        </Button>
      </div>
    );
  }

  return (
    <div className="relative w-full" ref={boxRef}>
      {mode === "member" ? (
        <>
          <input
            type="search"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search members"
            aria-label={`Who is doing ${positionLabel || "this position"}`}
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          />
          {open && term.trim().length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
              {hits.length === 0 ? (
                <li className="px-3 py-3 text-sm text-[var(--text-muted)]">No names match that search.</li>
              ) : (
                hits.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center px-3 text-left text-base active:bg-[var(--surface-2)]"
                      onClick={() => {
                        onPickMember({ id: m.id, full_name: m.full_name });
                        setTerm("");
                        setOpen(false);
                      }}
                    >
                      {m.full_name}
                    </button>
                  </li>
                ))
              )}
              <li className="border-t border-[var(--border)]">
                <button
                  type="button"
                  className="min-h-11 w-full px-3 text-left text-sm text-[var(--text-muted)]"
                  onClick={() => switchMode("guest")}
                >
                  Not on the roster — type a name
                </button>
              </li>
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <input
            type="text"
            value={row.free_text ?? ""}
            onChange={(e) => onTypeGuest(e.target.value)}
            placeholder="Guest name"
            aria-label={`Guest name for ${positionLabel || "this position"}`}
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          />
          <button
            type="button"
            className="mt-1 text-sm text-[var(--text-muted)] underline"
            onClick={() => switchMode("member")}
          >
            Search the roster instead
          </button>
        </>
      )}
    </div>
  );
}
