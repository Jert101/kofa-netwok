"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  filterUpcoming,
  pinOwnDays,
  type UpcomingDay,
  type UpcomingMass,
} from "@/lib/liturgy/upcoming";

/**
 * LIT-5: "Upcoming assignments" for the next 14 days.
 *
 * Two details the spec cares about, and both are about not letting the parish enumerate itself:
 *
 * - The server sends back the member's own rows with their id and everyone else's without one, so
 *   this component has no way to build the parish's roster out of the payload even if it tried.
 * - `viewer_identified` decides whether own rows are highlighted. A member who never declared an
 *   identity still gets the list; they just cannot be sure which rows are theirs, so pinning is
 *   skipped rather than guessed at.
 *
 * Search is client-side over the payload the member already has. Asking the server again per
 * keystroke would be slower and would turn the search box into a roster probe.
 */

type Payload = {
  today: string;
  window_days: number;
  viewer_identified: boolean;
  own_count: number;
  days: WireDay[];
};

/**
 * The API sends `time_label`, the rule types carry `time`. The wire wins, so the card is typed on
 * what actually arrives; `WireMass` still satisfies `UpcomingMass`, which is what the pure search
 * and pin helpers take.
 */
type WireMass = UpcomingMass & { time_label?: string | null };
type WireDay = Omit<UpcomingDay, "masses"> & { masses: WireMass[] };

export function UpcomingAssignmentsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/liturgy/upcoming", { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Payload);
    } catch {
      setError("Could not load upcoming assignments.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    if (!data) return [];
    const filtered = filterUpcoming(data.days, query);
    // Pinning only helps if the highlighting can be trusted; see above.
    return data.viewer_identified ? pinOwnDays(filtered) : filtered;
  }, [data, query]);

  if (error) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm text-[var(--danger)]">{error}</p>
        <button type="button" className="mt-2 text-sm underline" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm text-[var(--text-muted)]">Loading assignments…</p>
      </section>
    );
  }

  const total = data.days.reduce((n, d) => n + d.masses.reduce((m, mass) => m + mass.slots.length, 0), 0);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--brand)]">Upcoming assignments</h2>
        <p className="text-xs text-[var(--text-muted)]">Next {data.window_days} days</p>
      </div>

      {data.viewer_identified && data.own_count > 0 ? (
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {data.own_count} of yours, listed first.
        </p>
      ) : null}

      <label className="mt-3 block">
        <span className="sr-only">Search a name</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name"
          aria-label="Search a name in upcoming assignments"
          className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-base"
        />
      </label>

      {days.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          {total === 0
            ? "No assignments saved in this window yet."
            : query.trim().length > 0
              ? "Nothing matches that search."
              : "No assignments in this window."}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {days.map((d) => (
            <DayBlock key={d.date} day={d} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DayBlock({ day }: { day: WireDay }) {
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <Link href={`/member/day/${day.date}`} className="text-sm font-semibold text-[var(--brand)] hover:underline">
        {day.date}
      </Link>
      <ul className="mt-2 space-y-2">
        {day.masses.map((m) => (
          <MassBlock key={`${m.mass_id}-${m.session_id ?? "planned"}`} mass={m} />
        ))}
      </ul>
    </li>
  );
}

function MassBlock({ mass }: { mass: WireMass }) {
  return (
    <li>
      <p className="text-sm font-medium text-[var(--text)]">
        {mass.mass_name}
        {mass.time_label ? <span className="text-[var(--text-muted)]"> · {mass.time_label}</span> : null}
      </p>
      <ul className="mt-1 space-y-0.5">
        {mass.slots.map((s, i) => (
          <li
            key={`${s.position_label}-${i}`}
            className={`text-sm ${s.mine ? "font-semibold text-[var(--brand)]" : "text-[var(--text-muted)]"}`}
          >
            <span className="font-medium text-[var(--text)]">{s.position_label}:</span>{" "}
            {s.member_name ?? "unassigned"}
            {s.mine ? <span className="ml-1 text-xs">(you)</span> : null}
          </li>
        ))}
      </ul>
    </li>
  );
}
