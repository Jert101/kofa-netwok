"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type State = "ok" | "warn" | "error";

type Check = {
  id: string;
  label: string;
  state: State;
  detail: string;
  fix?: string;
  href?: string;
};

type Health = {
  state: State;
  checked_at: string;
  checks: Check[];
  summary: { ok: number; warn: number; error: number };
};

const HEADING: Record<State, { text: string; className: string }> = {
  ok: { text: "Everything looks healthy", className: "text-[var(--success)]" },
  warn: { text: "Something needs a look", className: "text-[var(--brand)]" },
  error: { text: "Something is broken", className: "text-[var(--danger)]" },
};

/**
 * SYS-3: the health page.
 *
 * A checklist, because the question is "is anything wrong" and a list answers that in one glance where a
 * dashboard of gauges does not. Red is reserved for things that are actually broken; a page that paints
 * itself red for a job that ran four days late gets ignored the one time it matters.
 *
 * Never shows a secret. Every environment check reports presence and length at most.
 */
export default function SystemHealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/admin/health", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const json = (await res.json()) as { data?: Health };
      setData(json.data ?? null);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const heading = data ? HEADING[data.state] : null;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">System health</h1>
          {data ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Checked {data.checked_at.slice(0, 16).replace("T", " ")} · {data.summary.ok} ok,{" "}
              {data.summary.warn} to look at, {data.summary.error} broken
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--text-muted)]">Checking…</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm font-medium"
        >
          Check again
        </button>
      </div>

      {failed ? (
        <p role="alert" className="rounded-2xl border border-dashed border-[var(--danger)] p-6 text-center text-sm text-[var(--danger)]">
          Could not run the health checks.
        </p>
      ) : null}

      {heading ? <p className={`text-base font-semibold ${heading.className}`}>{heading.text}</p> : null}

      {data ? (
        <ul className="space-y-2">
          {data.checks.map((check) => (
            <li key={check.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={
                    "mt-1.5 inline-block size-3 shrink-0 rounded-full " +
                    (check.state === "ok"
                      ? "bg-[var(--success)]"
                      : check.state === "warn"
                        ? "bg-[var(--brand)]"
                        : "bg-[var(--danger)]")
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {check.label}
                    {/* The word, not only the colour: a red dot and a red dot are the same to somebody
                        who cannot see red. */}
                    <span className="sr-only">
                      {check.state === "ok" ? " (ok)" : check.state === "warn" ? " (warning)" : " (problem)"}
                    </span>
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">{check.detail}</p>
                  {check.fix ? <p className="mt-1 text-sm">{check.fix}</p> : null}
                  {check.href ? (
                    <Link href={check.href} className="mt-1 inline-block text-sm underline">
                      Fix this
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-sm text-[var(--text-muted)]">
        This page reports whether required environment values are <em>set</em>. It never shows their
        contents, because it is a page people open in front of others.
      </p>
    </div>
  );
}