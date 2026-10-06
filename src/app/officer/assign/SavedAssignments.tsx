"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { churchTodayLabel } from "@/lib/time/church-time-labels";

export type SavedAssignment = {
  session_date: string;
  mass_id: string;
  mass_name: string;
  position_count: number;
  slots: Array<{ position_label: string; member_name: string | null }>;
  announced: boolean;
  announcement_delete_at: string | null;
  announcement_expired: boolean;
};

/**
 * What has actually been saved, with the three things you can do to each one.
 *
 * This is the read half of the CRUD, and its absence is why the queue felt like a dead end: saving a
 * month of assignments and closing the tab left no way back to them short of remembering a date and
 * typing it into the editor by hand. Everything below it is a way of *writing* an assignment; this is
 * the one screen that says what is already there.
 *
 * Three actions, deliberately not four. Editing the servers is not offered here because the plan
 * editor below already does it properly, one row at a time, and a second editor is a second set of
 * rules to get wrong. So this links to that one instead of reimplementing it.
 */
export function SavedAssignments({
  today,
  version,
  onEditRoster,
  onChanged,
}: {
  /** The parish's today, used to decide what can still be deleted. */
  today: string;
  /** Bumped by the page when the queue saved, to reload without remounting and losing what is open. */
  version: number;
  /** Load a date and Mass into the plan editor below. */
  onEditRoster: (sessionDate: string, massId: string) => void;
  /** Tell the page something changed so it can refresh whatever else it is showing. */
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<SavedAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [announcing, setAnnouncing] = useState<SavedAssignment | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/officer/assign", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        setError("Could not load the saved assignments.");
        setRows([]);
        return;
      }
      const body = (await res.json()) as { assignments?: SavedAssignment[] };
      setError(null);
      setRows(body.assignments ?? []);
    } catch {
      setError("Could not load the saved assignments.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const remove = async (row: SavedAssignment) => {
    const label = `${row.mass_name} on ${churchTodayLabel(row.session_date)}`;
    if (!window.confirm(`Delete the ${row.position_count} server assignment for ${label}? Its announcement goes too.`)) {
      return;
    }
    const key = `${row.session_date}|${row.mass_id}`;
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/officer/assign?session_date=${encodeURIComponent(row.session_date)}&mass_id=${encodeURIComponent(row.mass_id)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not delete that assignment.");
        return;
      }
      setNotice(`Deleted the assignment for ${label}.`);
      await load();
      onChanged();
    } catch {
      setError("Could not reach the server, so nothing was deleted.");
    } finally {
      setBusyKey(null);
    }
  };

  const list = rows ?? [];

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-medium">Saved assignments</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Upcoming Masses that already have servers. Editing a roster opens it in the editor below.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm text-[var(--text-muted)]">
          {notice}
        </p>
      ) : null}

      {rows === null ? <p className="mt-3 text-sm text-[var(--text-muted)]">Loading…</p> : null}

      {rows !== null && list.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Nothing saved yet. Add an assignment above, then save it.
        </p>
      ) : null}

      {list.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {list.map((row) => {
            const key = `${row.session_date}|${row.mass_id}`;
            const busy = busyKey === key;
            const past = today !== "" && row.session_date < today;
            return (
              <li key={key} className="rounded-xl border border-[var(--border)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === key ? null : key)}
                    aria-expanded={expanded === key}
                    className="min-h-11 min-w-0 font-medium underline"
                  >
                    {churchTodayLabel(row.session_date)} · {row.mass_name}
                  </button>
                  <span className="text-xs text-[var(--text-muted)]">
                    {row.position_count} position{row.position_count === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {row.announced
                      ? row.announcement_expired
                        ? "Announcement has run out"
                        : `Announced until ${
                            row.announcement_delete_at
                              ? churchTodayLabel(row.announcement_delete_at)
                              : "further notice"
                          }`
                      : "Not announced"}
                  </span>

                  <span className="ml-auto flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => onEditRoster(row.session_date, row.mass_id)}>
                      Edit servers
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAnnouncing(row)}>
                      {row.announced ? "Change announcement" : "Announce"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void remove(row)}
                      disabled={busy || past}
                      title={
                        past
                          ? "That Mass has already happened, so its record stays as it was."
                          : undefined
                      }
                    >
                      {busy ? "Deleting…" : "Delete"}
                    </Button>
                  </span>
                </div>

                {past ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Already happened — kept for the record, so it cannot be deleted by accident.
                  </p>
                ) : null}

                {expanded === key ? (
                  <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-sm text-[var(--text-muted)]">
                    {row.slots.map((s, i) => (
                      <li key={`${s.position_label}-${i}`}>
                        <span className="text-[var(--text)]">{s.position_label}</span> —{" "}
                        {s.member_name ?? "nobody yet"}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {announcing ? (
        <AnnouncementDialog
          row={announcing}
          onClose={() => setAnnouncing(null)}
          onSaved={(message) => {
            setAnnouncing(null);
            setNotice(message);
            void load();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Change one saved assignment's announcement without touching who is serving.
 *
 * Separate from the queue's announce checkbox because they answer different questions. The checkbox
 * is "should this be published when I save it"; this is "the parish has been told, that is wrong,
 * take it down" or "still tell them, but not for a month".
 */
function AnnouncementDialog({
  row,
  onClose,
  onSaved,
}: {
  row: SavedAssignment;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [announce, setAnnounce] = useState(true);
  const [deleteAt, setDeleteAt] = useState(
    row.announcement_delete_at ? row.announcement_delete_at.slice(0, 10) : row.session_date,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/officer/assign", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_date: row.session_date,
          mass_id: row.mass_id,
          announce,
          announce_delete_at: announce ? deleteAt : null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setProblem(body.error ?? "Could not change the announcement.");
        return;
      }
      onSaved(
        announce
          ? `Announced ${row.mass_name} on ${churchTodayLabel(row.session_date)}.`
          : `Took down the announcement for ${row.mass_name} on ${churchTodayLabel(row.session_date)}.`,
      );
    } catch {
      setProblem("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {row.announced ? "Change the announcement" : "Announce this assignment"}
          </DialogTitle>
          <DialogDescription>
            {row.mass_name} on {churchTodayLabel(row.session_date)}, {row.position_count} position
            {row.position_count === 1 ? "" : "s"}. Nobody&rsquo;s assignment is changed by this.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-start gap-2 rounded-xl border border-[var(--border)] p-3 text-sm">
            <input
              type="checkbox"
              checked={announce}
              onChange={(e) => setAnnounce(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Show this roster in the announcements feed</span>
              <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                Untick it to take the existing notice down rather than leaving it to expire.
              </span>
            </span>
          </label>

          {announce ? (
            <label className="block">
              <span className="text-sm font-medium">Delete the announcement on</span>
              <input
                type="date"
                value={deleteAt}
                min={row.session_date}
                onChange={(e) => setDeleteAt(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              />
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                Visible through this day, removed the next day.
              </span>
            </label>
          ) : null}

          {problem ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {problem}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : announce ? "Announce" : "Take it down"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}