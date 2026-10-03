"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatPeso } from "@/lib/format-peso";

type Entry = {
  structureId: string;
  structureName: string;
  amount: string | null;
  paid: string | null;
  remaining: string | null;
  credit: string | null;
  settled: boolean;
  isActive: boolean;
};

type LookupResponse = {
  found: boolean;
  as_of: string;
  member: { id: string; full_name: string; batch: string | null; is_active: boolean };
  amounts_visible: boolean;
  is_self: boolean;
  note: string;
  entries: Entry[];
};

/**
 * PAY-7: the one lookup page, replacing four identical copies of `PaymentLookup`.
 *
 * ## Why this exists
 *
 * `PaymentLookup` was mounted on the admin, secretary, officer and member pages, identical except for
 * one line of wording, and it read `GET /api/admin/payments`, which allowed all four roles. Any
 * signed-in member could type any other member's name and read their peso amounts. Spec §P6, and the
 * acceptance criterion is explicit that this has to be fixed in the API and not only hidden in the UI.
 *
 * So the page renders whatever the endpoint decides. When the numbers come back null it says so, in
 * words, rather than rendering an empty cell that looks like a bug. Decision D-9 recommended that only
 * the treasurer and admin see balances and that is what the API enforces.
 *
 * A member gets their own record without searching for themselves: `?self=1` uses the declared
 * identity from the session, which is also what stops somebody typing a near-miss of their own name
 * and being told they do not exist.
 */
export function PaymentLookupPage({
  heading,
  description,
  memberId,
  selfOnly = false,
}: {
  heading: string;
  description: string;
  /** The signed-in person's own member id, so their record needs no search box. */
  memberId?: string | null;
  selfOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (params: URLSearchParams) => {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/lookup?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(json?.error?.message ?? "Could not look that up.");
        return;
      }
      const json = (await res.json()) as { data?: LookupResponse };
      setResult(json.data ?? null);
    } catch {
      setError("Could not look that up.");
    } finally {
      setSearching(false);
    }
  }, []);

  // A member's own record, without asking them to spell their own name. The id comes from the session
  // via a server component, not from a search box, which is also what stops somebody typing a near-miss
  // of their own name and being told they do not exist.
  useEffect(() => {
    if (!selfOnly || !memberId) return;
    void run(new URLSearchParams({ member_id: memberId }));
  }, [selfOnly, memberId, run]);

  // Debounced, because this hits the database on every keystroke otherwise and the parish roll is
  // small enough that the response arrives before the next letter does.
  useEffect(() => {
    if (selfOnly) return;
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length >= 2) {
      debounce.current = setTimeout(() => void run(new URLSearchParams({ q })), 250);
      return;
    }
    setResult(null);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, run, selfOnly]);

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-lg font-semibold">{heading}</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
      </div>

      {!selfOnly ? (
        <label className="block">
          <span className="sr-only">Search for a member</span>
          <input
            type="search"
            className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
            placeholder="Type at least two letters of a name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {searching ? <p className="text-sm text-[var(--text-muted)]">Searching…</p> : null}

      {!searching && result?.found ? (
        <section aria-labelledby="lookup-member" className="space-y-3">
          <div>
            <h2 id="lookup-member" className="font-medium">
              {result.member.full_name}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              {result.member.batch ? `Batch ${result.member.batch} · ` : ""}
              {result.member.is_active ? "Active" : "Inactive"} · {result.note}
            </p>
          </div>

          {result.entries.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
              No payment structures apply to this member.
            </p>
          ) : (
            <ul className="space-y-2">
              {result.entries.map((entry) => (
                <li
                  key={entry.structureId}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {entry.structureName}
                      {!entry.isActive ? (
                        <span className="ml-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                          inactive
                        </span>
                      ) : null}
                    </p>
                    {entry.settled ? (
                      <span className="text-sm font-medium text-[var(--success)]">Paid up</span>
                    ) : (
                      <span className="text-sm font-medium text-[var(--danger)]">Not paid up</span>
                    )}
                  </div>

                  {result.amounts_visible ? (
                    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-[var(--text-muted)]">Amount</dt>
                        <dd>{entry.amount !== null ? formatPeso(Number(entry.amount)) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-muted)]">Paid</dt>
                        <dd>{entry.paid !== null ? formatPeso(Number(entry.paid)) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-muted)]">Remaining</dt>
                        <dd>
                          {entry.remaining !== null ? formatPeso(Number(entry.remaining)) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-muted)]">Credit</dt>
                        <dd>{entry.credit !== null ? formatPeso(Number(entry.credit)) : "—"}</dd>
                      </div>
                    </dl>
                  ) : (
                    // Said in words rather than left blank. An empty cell reads as a bug; this reads as
                    // a decision, which is what it is.
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      Amounts are kept by the treasurer. Ask them if you need the figure.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {!searching && !result && query.trim().length >= 2 && !error ? (
        <p className="text-sm text-[var(--text-muted)]">No member found by that name.</p>
      ) : null}
    </div>
  );
}