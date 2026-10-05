"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type SessionRow = {
  id: string;
  mass_name: string;
  present_count: number;
};

/**
 * ATT-3 day view.
 *
 * Deliberately a list rather than a form. The secretary's job here is to pick a Mass,
 * not to encode attendance — encoding happens on the session screen where the roster
 * and undo live together. Keeping this thin means there is one place where a tap can
 * mean "record 40 people" and only one.
 */
export function DayView({
  date,
  basePath,
  sessionBasePath,
  emptyHint,
  canAdd = true,
}: {
  date: string;
  /** Where "add session" lives, e.g. /secretary/day/[date]/add. */
  basePath: string;
  /** Where each session opens, e.g. /secretary/session/[id]. */
  sessionBasePath: string;
  emptyHint: string;
  /** Members browse; only staff add sessions. */
  canAdd?: boolean;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/by-day?date=${encodeURIComponent(date)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setLoadFailed(true);
        setSessions([]);
        return;
      }
      // Enveloped response: `sessions` sits under `data`. Reading `j.sessions` is undefined on every
      // load, so the day view rendered as a day with no Masses on it.
      const j = (await res.json()) as { data?: { sessions?: SessionRow[] } };
      setLoadFailed(false);
      setSessions(j.data?.sessions ?? []);
    } catch {
      setLoadFailed(true);
      setSessions([]);
    }
  }, [date]);

  useEffect(() => {
    setSessions(null);
    void load();
  }, [load]);

  return (
    <div>
      <Button type="button" variant="ghost" size="sm" onClick={() => router.back()} className="mb-3">
        ← Back
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{date}</h1>
        {canAdd ? (
          <Button type="button" size="sm" asChild className="min-h-11">
            <Link href={`${basePath}/add`}>+ Add session</Link>
          </Button>
        ) : null}
      </div>

      {sessions === null ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">Loading…</p>
      ) : loadFailed ? (
        <div role="alert" className="mt-4 rounded-2xl border border-dashed border-[var(--danger)] p-6 text-center">
          <p className="text-sm font-medium text-[var(--danger)]">
            Could not load this day&apos;s sessions.
          </p>
          <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : sessions.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">{emptyHint}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`${sessionBasePath}/${s.id}`}
                className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 active:bg-[var(--surface-2)]"
              >
                <span className="font-medium">{s.mass_name}</span>
                <span className="text-sm text-[var(--text-muted)]">
                  {s.present_count} present
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Thin wrapper so each role's page stays a one-liner. */
export function RoleDayView({
  role,
  date,
}: {
  role: "member" | "secretary" | "admin" | "officer";
  date: string;
}) {
  // Spelled out per role rather than derived from the role name: admin and officer keep
  // the date in their session URL, secretary and member do not. Those layouts came from
  // earlier modules and are not worth churning to make one template fit.
  const sessionBasePath =
    role === "secretary"
      ? "/secretary/session"
      : role === "member"
        ? `/member/day/${date}/session`
        : `/${role}/day/${date}/session`;

  return (
    <DayView
      date={date}
      basePath={`/${role}/day/${date}`}
      sessionBasePath={sessionBasePath}
      emptyHint={role === "member" ? "No Mass was recorded on this day." : "No sessions on this day yet."}
      // Matches who can actually create a session. `POST /api/attendance/session` is declared for the
      // secretary, so the secretary and -- because an admin reaches the secretary -- the admin can post
      // one. The officer cannot, and offering the button used to send them to a route that did not exist.
      canAdd={role === "secretary" || role === "admin"}
    />
  );
}
