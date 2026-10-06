"use client";

import { useCallback, useEffect, useState } from "react";

export type AnnouncementItem = {
  id: string;
  title: string;
  body: string;
  created_by: "admin" | "secretary" | "officer" | "system";
  created_at: string;
  updated_at: string | null;
  delete_at: string | null;
  pinned: boolean;
  audience?: string;
  /** The date of the Mass, when this post is a generated roster rather than a written notice. */
  liturgy?: string | null;
};

const PAGE = 5;

/**
 * COM-2: the announcements feed.
 *
 * Reads `GET /api/announcements`, which already applied the audience filter and the pin order on the
 * server. Doing either here would be the bug P3 describes: a post meant for one batch would still
 * exist in the payload the browser had downloaded, and hiding it in the UI is a promise, not a rule.
 *
 * System posts look different because they are generated. A birthday greeting rendered like an
 * officer's notice reads as something a human wrote to them, and the parish would thank the wrong
 * person.
 */
export function AnnouncementsFeed() {
  const [rows, setRows] = useState<AnnouncementItem[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Could not load announcements.");
        setRows([]);
        return;
      }
      const j = (await res.json()) as { announcements?: AnnouncementItem[] };
      setError(null);
      setRows(j.announcements ?? []);
    } catch {
      setError("Could not load announcements.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand)]">Announcements</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Loading announcements...</p>
      </section>
    );
  }

  const visible = rows.slice(0, shown);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--brand)]">Announcements</h2>

      {error ? <p className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">No announcements yet.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {visible.map((a) => {
              const system = a.created_by === "system";
              const roster = Boolean(a.liturgy);
              return (
                <li
                  key={a.id}
                  id={a.id}
                  className={
                    "rounded-xl border bg-[var(--surface-2)] " +
                    (a.pinned ? "border-[var(--brand)]" : "border-[var(--border)]") +
                    (system || roster ? " bg-[var(--surface)]" : "")
                  }
                >
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          {a.pinned ? (
                            <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 text-xs font-medium text-white">
                              Pinned
                            </span>
                          ) : null}
                          {/* A generated roster in the same style as a typed notice reads as
                              something a human wrote to the parish, so it is labelled instead. */}
                          {roster ? (
                            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                              Servers
                            </span>
                          ) : null}
                          <span className="font-medium text-[var(--text)]">{a.title}</span>
                        </span>
                        <span className="mt-1 block text-xs text-[var(--text-muted)]">
                          {roster
                            ? "Server assignment"
                            : system
                              ? "Parish office"
                              : `By ${a.created_by}`}
                          {" · "}
                          {new Date(a.created_at).toLocaleDateString()}
                          {a.updated_at ? " · Edited" : ""}
                          {a.audience && a.audience !== "Everyone" ? ` · For ${a.audience}` : ""}
                        </span>
                      </span>
                      <span aria-hidden className="mt-1 text-xs text-[var(--text-muted)] group-open:rotate-180">
                        ▼
                      </span>
                    </summary>
                    <div className="border-t border-[var(--border)] px-3 pb-3 pt-2">
                      <p className="whitespace-pre-wrap text-sm text-[var(--text-muted)]">{a.body}</p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>

          {rows.length > shown ? (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE * 2)}
              className="mt-3 min-h-11 w-full rounded-xl border border-[var(--border)] text-sm font-medium"
            >
              Show older ({rows.length - shown} more)
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
