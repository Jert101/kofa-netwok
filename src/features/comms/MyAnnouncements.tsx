"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_PINNED, TITLE_MAX, BODY_MAX, type AnnouncementRow } from "@/lib/announcements/audience";

type Mine = AnnouncementRow & {
  title: string;
  body: string;
  created_by: string;
  created_at: string;
  audience?: string;
  audience_roles?: string[] | null;
  audience_batches?: string[] | null;
};

/** How many rows the list shows before "Show older". Ten is about a screen and a half on a phone. */
const PAGE = 10;

/**
 * COM-1: what this role has posted, and the controls to change it.
 *
 * The pin limit is enforced by the server, so the error from a fourth pin is surfaced verbatim
 * rather than being re-worded here: the message it produces is the useful one, because it tells the
 * author the truth about a limit they cannot see from this page.
 */
export function MyAnnouncements({ role }: { role: string }) {
  const [rows, setRows] = useState<Mine[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/announcements?mine=1", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) {
      setError("Could not load your announcements.");
      setRows([]);
      return;
    }
    const j = (await res.json()) as { announcements?: Mine[] };
    setRows(j.announcements ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/announcements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? "Could not update the announcement.");
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? Members will stop seeing it immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/announcements/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? "Could not delete the announcement.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const visible = (rows ?? []).slice(0, shown);

  return (
    <section className="space-y-3" aria-label="Your announcements">
      <h2 className="text-sm font-semibold text-[var(--text-muted)]">Posted by {role}</h2>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      {rows === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nothing posted yet.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {visible.map((a) => {
              const system = a.created_by === "system";
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  {editing === a.id ? (
                    <div className="space-y-2">
                      <input
                        value={draft.title}
                        maxLength={TITLE_MAX}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        className="w-full min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3"
                      />
                      <textarea
                        value={draft.body}
                        maxLength={BODY_MAX}
                        rows={4}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="min-h-10 rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white disabled:opacity-40"
                          onClick={async () => {
                            const ok = await patch(a.id, {
                              title: draft.title.trim(),
                              body: draft.body.trim(),
                            });
                            if (ok) setEditing(null);
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm font-medium"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-medium text-[var(--text)]">
                        {a.pinned ? (
                          <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 text-xs text-white">
                            Pinned
                          </span>
                        ) : null}
                        {a.title}
                        {a.updated_at ? (
                          <span className="text-xs font-normal text-[var(--text-muted)]">
                            Edited {new Date(a.updated_at).toLocaleString()}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{a.body}</p>
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        {a.audience ? `To: ${a.audience}` : null}
                        {a.delete_at ? ` · Expires ${new Date(a.delete_at).toLocaleString()}` : " · No expiry"}
                      </p>

                      {system ? (
                        <p className="mt-2 text-xs text-[var(--text-muted)]">
                          Posted automatically. These cannot be edited.
                        </p>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-40"
                            onClick={() => {
                              setEditing(a.id);
                              setDraft({ title: a.title, body: a.body });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-40"
                            onClick={() => patch(a.id, { pinned: !a.pinned })}
                          >
                            {a.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-10 rounded-lg bg-[var(--danger)] px-3 text-sm font-medium text-white disabled:opacity-40"
                            onClick={() => remove(a.id, a.title)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {rows.length > shown ? (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE * 2)}
              className="min-h-11 w-full rounded-xl border border-[var(--border)] text-sm font-medium"
            >
              Show older ({rows.length - shown} more)
            </button>
          ) : null}
          {rows.length > MAX_PINNED * 4 && shown >= rows.length ? (
            <p className="text-xs text-[var(--text-muted)]">
              Old posts are swept once they expire. At most {MAX_PINNED} posts stay pinned.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
