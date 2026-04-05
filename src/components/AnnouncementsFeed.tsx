"use client";

import { useEffect, useState } from "react";

export type AnnouncementItem = {
  id: string;
  title: string;
  body: string;
  created_by: "admin" | "secretary" | "officer";
  created_at: string;
};

/** Same announcement list for every role (GET /api/announcements, not ?mine=1). */
export function AnnouncementsFeed() {
  const [announcements, setAnnouncements] = useState<AnnouncementItem[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/announcements", { credentials: "same-origin" });
      if (!res.ok) {
        setAnnouncements([]);
        return;
      }
      const j = (await res.json()) as { announcements?: AnnouncementItem[] };
      setAnnouncements(j.announcements ?? []);
    })();
  }, []);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--accent)]">Announcements</h2>
      {announcements === null ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Loading announcements…</p>
      ) : announcements.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No announcements yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {announcements.map((a) => (
            <li key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
                  <span className="font-medium text-[var(--text)]">{a.title}</span>
                  <span className="text-xs text-[var(--muted)] group-open:rotate-180">▼</span>
                </summary>
                <div className="border-t border-[var(--border)] px-3 pb-3 pt-2">
                  <p className="whitespace-pre-wrap text-sm text-[var(--muted)]">{a.body}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    By {a.created_by} · {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
