"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type SessionRow = { id: string; mass_name: string; server_count: number };

export default function MemberDayPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/attendance/by-day?date=${encodeURIComponent(date)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        router.replace("/member");
        return;
      }
      const j = (await res.json()) as { sessions: SessionRow[] };
      if (!cancelled) setSessions(j.sessions);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, router]);

  return (
    <div>
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-3 min-h-11 text-sm font-medium text-[var(--accent)]"
      >
        ← Back
      </button>
      <h1 className="text-lg font-semibold">{date}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Select a mass</p>
      <ul className="mt-4 space-y-2">
        {sessions === null ? (
          <li className="text-sm text-[var(--muted)]">Loading…</li>
        ) : sessions.length === 0 ? (
          <li className="text-sm text-[var(--muted)]">No masses recorded for this day.</li>
        ) : (
          sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/member/day/${date}/session/${s.id}`}
                className="flex min-h-14 items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 active:bg-[var(--surface-2)]"
              >
                <span className="font-medium">{s.mass_name}</span>
                <span className="text-sm text-[var(--muted)]">{s.server_count} servers</span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
