"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeLabel } from "@/lib/liturgy/rules";
import { rowPositionLabel, type EditorRow } from "@/lib/liturgy/editor-rows";

/**
 * LIT-1's position combobox.
 *
 * Two behaviours that look contradictory and are not:
 *
 * - It suggests from the catalog, so casing and spelling stay consistent (that is LIT-1's
 *   acceptance criterion: "casing and spelling stay consistent after a week of use").
 * - It also accepts a label that is not in the catalog, because the parish may add a role and the
 *   officer should not have to wait for anyone to seed it. A newly typed label is added to the
 *   catalog by the save that follows, not here.
 *
 * That second point is why typing is never rewritten under the cursor. Re-casing a half-typed
 * label mid-keystroke would fight the officer, so the canonical casing is applied on blur, when
 * there is no keystroke to interrupt.
 */

export type PositionInputProps = {
  row: EditorRow;
  catalog: string[];
  onChange: (label: string) => void;
};

export function PositionInput({ row, catalog, onChange }: PositionInputProps) {
  // Local text plus the label it was seeded from. A template load or a copy replaces rows
  // wholesale, and `term` has to follow; tracking the seed makes that a render-time comparison
  // instead of an effect that briefly shows the old text over the new value.
  const [state, setState] = useState(() => ({
    seeded: rowPositionLabel(row),
    term: rowPositionLabel(row),
  }));
  const current = rowPositionLabel(row);
  const term = state.seeded === current ? state.term : current;
  const setTerm = (next: string) => setState({ seeded: current, term: next });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const typed = term.trim();
  const norm = normalizeLabel(typed);
  const suggestions = catalog.filter((c) => {
    if (norm.length === 0) return true;
    return normalizeLabel(c).includes(norm);
  });

  // Offered casing for a label the officer typed that the catalog already knows. Only on blur: the
  // canonical form is a correction, not a live echo.
  const canonical = catalog.find((c) => normalizeLabel(c) === norm);

  const commit = () => {
    setOpen(false);
    if (canonical && norm.length > 0 && rowPositionLabel({ ...row, position_label: typed }) !== canonical) {
      onChange(canonical);
    } else {
      onChange(typed);
    }
  };

  return (
    <div className="relative w-full" ref={boxRef}>
      <input
        type="text"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            // Enter must pick the visible suggestion rather than submit the form, or choosing a
            // position on a phone keyboard jumps the page instead of filling the row.
            e.preventDefault();
            if (suggestions.length > 0) onChange(suggestions[0]);
            else commit();
            setOpen(false);
          }
        }}
        placeholder="Position"
        aria-label="Position"
        autoComplete="off"
        list="liturgy-position-suggestions"
        className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
      />
      <datalist id="liturgy-position-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {open && suggestions.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {suggestions.slice(0, 12).map((s) => (
            <li key={s}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center px-3 text-left text-base active:bg-[var(--surface-2)]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s);
                  setTerm(s);
                  setOpen(false);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
