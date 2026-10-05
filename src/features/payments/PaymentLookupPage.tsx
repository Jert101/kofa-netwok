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
  // Absent when `found` is false: the route answers `{ found: false, results: [], results_count: 0 }`
  // and nothing else. Declaring them as present is what let `result.member` typecheck behind a `found`
  // guard that a future edit could easily drop -- and then it would be undefined at runtime.
  as_of?: string;
  member?: { id: string; full_name: string; batch: string | null; is_active: boolean };
  amounts_visible?: boolean;
  is_self?: boolean;
  note?: string;
  entries?: Entry[];
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
  const searchSeq = useRef(0);

  const run = useCallback(async (params: URLSearchParams) => {
    setSearching(true);
    setError(null);
    // A response that lands after a newer search has begun describes a question the user has already
    // moved on from, and would overwrite the newer answer. Numbering the requests is cheaper and more
    // honest than a boolean: the last one to be *asked* wins, not the last one to *arrive*.
    const ticket = ++searchSeq.current;
    try {
      const res = await fetch(`/api/payments/lookup?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (ticket !== searchSeq.current) return;
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        // Drop the previous result on a failure. Leaving it on screen put one member's name, batch and
        // peso table under an error banner about a different search, and nothing in the view said which
        // member it belonged to.
        setResult(null);
        setError(json?.error?.message ?? "Could not look that up.");
        return;
      }
      const json = (await res.json()) as { data?: LookupResponse };
      setResult(json.data ?? null);
    } catch {
      if (ticket !== searchSeq.current) return;
      setResult(null);
      setError("Could not look that up.");
    } finally {
      if (ticket === searchSeq.current) setSearching(false);
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

  /*
    Narrowed once, here, rather than trusting `found` to imply the payload is there. The route's
    not-found answer carries `found: false` and none of these fields, and the alternative -- reading
    `result.member` behind a `found` check -- is exactly the shape that typechecks and then throws.
  */
  const match =
    result?.found && result.member && result.entries ? { ...result, member: result.member, entries: result.entries } : null;

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

      {match ? (
        <section aria-labelledby="lookup-member" className="space-y-3">
          <div>
            <h2 id="lookup-member" className="font-medium">
              {match.member.full_name}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              {match.member.batch ? `Batch ${match.member.batch} · ` : ""}
              {match.member.is_active ? "Active" : "Inactive"} · {match.note}
            </p>
          </div>

          {match.entries.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
              No payment structures apply to this member.
            </p>
          ) : (
            <ul className="space-y-2">
              {match.entries.map((entry) => (
                <li
                  key={entry.structureId}
                  className="rounded-xl border border-[var(--border)] p-3 text-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {entry.structureName}
                      {!entry.isActive ? (
                        <span className="ml-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                          inactive
                        </span>
                      ) : null}
                    </span>
                    <span className={entry.settled ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                      {entry.settled ? "Paid up" : "Not paid up"}
                    </span>
                  </div>

                  {/*
                    `amount` and the rest arrive nulled when the viewer may not see them, so this is a
                    real branch rather than a formatting edge case. The settled/not word above is the
                    part everyone is allowed to know; the figures are not, and the page says which it
                    is showing instead of leaving a peso column blank.
                  */}
                  {match.amounts_visible ? (
                    <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                      <div>
                        <dt className="text-[var(--text-muted)]">Amount</dt>
                        <dd>{entry.amount === null ? "—" : formatPeso(Number(entry.amount))}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-muted)]">Paid</dt>
                        <dd>{entry.paid === null ? "—" : formatPeso(Number(entry.paid))}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-muted)]">Remaining</dt>
                        <dd className="font-medium">
                          {entry.remaining === null ? "—" : formatPeso(Number(entry.remaining))}
                        </dd>
                      </div>
                    </dl>
                  ) : null}

                  {entry.credit !== null && Number(entry.credit) > 0 ? (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {formatPeso(Number(entry.credit))} paid over. It is held as a credit.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/*
        A name that matched nobody comes back as `{ found: false, results: [], results_count: 0 }` --
        a 200 with a populated body, not a null. So this used to test `!result`, which was only ever true
        before the first search, and the line was unreachable: the member card is skipped because
        `found` is false, and this is skipped because `result` is truthy. A search for somebody who does
        not exist rendered neither a card nor a word.
      */}
      {!searching && result && !result.found && !error ? (
        <p className="text-sm text-[var(--text-muted)]">No member found by that name.</p>
      ) : null}
    </div>
  );
}
