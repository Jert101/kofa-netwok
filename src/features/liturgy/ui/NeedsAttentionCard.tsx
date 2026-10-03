"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { attentionSummary, type AttentionItem } from "@/lib/liturgy/upcoming";

/**
 * LIT-5's officer half: "Needs attention".
 *
 * Every item links straight into the Mass that needs work. A worklist that makes the officer
 * navigate back to the date and pick the right Mass themselves has already lost half its value, and
 * the "no plan at all" case is exactly the one where there is nothing on the day page to click.
 *
 * The two reasons are labelled rather than merged. "No plan" is a blank page; "3 positions
 * unassigned" is a page with holes. Collapsing them into one number would make a parish that has
 * not started look identical to one that is nearly finished.
 */

type Payload = {
  today: string;
  window_days: number;
  summary: string;
  items: Array<AttentionItem & { label: string }>;
};

export function NeedsAttentionCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/liturgy/needs-attention", { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Payload);
    } catch {
      setError("Could not load the worklist.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        <p className="text-sm text-[var(--text-muted)]">Checking the next 14 days…</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--brand)]">Needs attention</h2>
        <p className="text-xs text-[var(--text-muted)]">Next {data.window_days} days</p>
      </div>

      {data.items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">{attentionSummary([])}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{data.summary}</p>
          <ul className="mt-3 space-y-2">
            {data.items.map((item) => (
              <li
                key={`${item.date}-${item.mass_id}`}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text)]">
                    {item.label} · {item.mass_name}
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">
                    {item.reason === "no_plan"
                      ? "No plan yet"
                      : `${item.unassigned} of ${item.positions} unassigned`}
                    {item.unassigned_labels.length > 0 ? (
                      <span className="block text-xs">Missing: {item.unassigned_labels.join(", ")}</span>
                    ) : null}
                  </p>
                </div>
                <Link
                  href={`/officer/day/${item.date}/plan/${item.mass_id}`}
                  className="shrink-0 text-sm font-medium text-[var(--brand)] underline"
                >
                  Plan it
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
