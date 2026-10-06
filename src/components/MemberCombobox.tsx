"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * One member search box, used wherever a member has to be chosen from a roll.
 *
 * A `<select>` was the wrong control for this: the parish roll is a hundred-odd names, and a native
 * dropdown on a phone gives you a list you have to scroll blind with no way to type, which is exactly
 * the moment a treasurer is looking for one name. This types instead, filters as you go, and shows the
 * handful of people who actually match.
 *
 * Two sources, so both callers can use it:
 * - pass `options` and it filters that list locally (the payment sheet already has the roll loaded and
 *   needs to filter it by the chosen structure's batch);
 * - pass nothing and it queries `/api/members/search`, which is what the assign page does.
 */

export type MemberHit = { id: string; full_name: string };

export type MemberComboboxProps = {
  /** The chosen member, or null. An object rather than an id so the label survives a re-render. */
  value: MemberHit | null;
  onChange: (value: MemberHit | null) => void;
  /** Filter this list instead of querying. Omit to search the API. */
  options?: readonly (MemberHit & Record<string, unknown>)[];
  /** Extra text for a row, e.g. the batch and whether the member is inactive. */
  renderMeta?: (option: MemberHit & Record<string, unknown>) => string;
  disabled?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  /** Shown in place of the input, e.g. "Choose a structure first". */
  disabledHint?: string;
  id?: string;
  label?: string;
};

const DEBOUNCE_MS = 180;

export function MemberCombobox({
  value,
  onChange,
  options,
  renderMeta,
  disabled = false,
  placeholder = "Search member…",
  emptyMessage = "No names match.",
  disabledHint,
  id,
  label = "Member",
}: MemberComboboxProps) {
  const [term, setTerm] = useState("");
  const [remote, setRemote] = useState<MemberHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Tap-away closes the list. Without this the results stay open over whatever is below them.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // Server-side search, only when the caller is not filtering its own list.
  useEffect(() => {
    if (options) return;
    const q = term.trim();
    if (q.length < 1) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}&limit=12`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { members?: MemberHit[] };
        if (!cancelled) setRemote(body.members ?? []);
      } catch {
        // A failed search must not interrupt typing; the empty state says what happened.
        if (!cancelled) setRemote([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, options]);

  const matches = useMemo(() => {
    if (options) {
      const needle = term.trim().toLowerCase();
      if (needle.length === 0) return options.slice(0, 12);
      return options
        .filter((o) => o.full_name.toLowerCase().includes(needle))
        .slice(0, 12);
    }
    return remote;
  }, [options, remote, term]);

  if (disabled) {
    return (
      <div>
        <span className="text-sm font-medium">{label}</span>
        <p className="mt-1 min-h-12 rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--text-muted)]">
          {disabledHint ?? "Unavailable"}
        </p>
      </div>
    );
  }

  if (value) {
    return (
      <div>
        {/* Empty label renders nothing: inside a position row the position is already named a few
            pixels above, and "Server" printed over "Server" is noise on a screen with four of them. */}
        {label ? <span className="text-sm font-medium">{label}</span> : null}
        <div className="mt-1 flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
          <span className="min-w-0 flex-1 truncate font-medium">{value.full_name}</span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setTerm("");
              setRemote([]);
            }}
            className="min-h-11 shrink-0 rounded-lg px-2 text-sm text-[var(--text-muted)] underline"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {label ? (
        <label className="text-sm font-medium" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="relative" ref={boxRef}>
        <input
          id={id}
          type="search"
          value={term}
          autoComplete="off"
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
        />
        {open ? (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
            {matches.length === 0 ? (
              <li className="px-3 py-3 text-sm text-[var(--text-muted)]">
                {term.trim().length === 0 ? "Type a name to search." : emptyMessage}
              </li>
            ) : (
              matches.map((m) => {
                const meta = renderMeta?.(m);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full flex-col justify-center px-3 text-left active:bg-[var(--surface-2)]"
                      onClick={() => {
                        onChange({ id: m.id, full_name: m.full_name });
                        setTerm("");
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{m.full_name}</span>
                      {meta ? (
                        <span className="truncate text-xs text-[var(--text-muted)]">{meta}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}