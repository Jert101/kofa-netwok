"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { NewAssignmentModal } from "./NewAssignmentModal";
import { SavedAssignments, type SavedAssignment } from "./SavedAssignments";
import {
  draftFilled,
  draftKey,
  draftUnassigned,
  draftSlots,
  upsertDraft,
  type AssignmentDraft,
} from "@/lib/liturgy/assign-batch";
import { churchTodayLabel } from "@/lib/time/church-time-labels";

type Mass = { id: string; name: string; is_active?: boolean };
type Template = { id: string; name: string; slot_count?: number };

type EntryResult = {
  session_date: string;
  mass_id: string;
  mass_name: string;
  ok: boolean;
  saved: number;
  announced: boolean;
  announcement_id: string | null;
  message: string;
};

/**
 * Server assignments: queue them here, then save them together.
 *
 * Everything about *writing* an assignment happens in one dialog -- the date, the Mass, the positions
 * and who is on them. This page has two jobs and no others: hold the queue before it is saved, and show
 * what already is.
 *
 * It used to also carry a hand-picked editor and a date-range filler underneath. Both are gone because
 * they were a second and third way to do what the dialog now does, each with its own date and Mass
 * fields sitting next to the dialog's identical ones -- which is how somebody fills in the wrong one.
 */
export default function OfficerAssignPage() {
  const [masses, setMasses] = useState<Mass[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Added through the modal and not yet written. */
  const [drafts, setDrafts] = useState<AssignmentDraft[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  /** What the modal is editing: a queued entry, a saved assignment, or null for a new one. */
  const [editingDraft, setEditingDraft] = useState<AssignmentDraft | null>(null);
  /**
   * Keys that came from a saved assignment rather than being new.
   *
   * Those always replace. The "replace" tick exists to stop an accidental *new* Sunday overwriting a
   * roster somebody wrote by hand, which is not the situation when the officer opened the thing on
   * purpose to correct it.
   */
  const [editingSaved, setEditingSaved] = useState<Set<string>>(new Set());
  const [savingQueue, setSavingQueue] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [queueReport, setQueueReport] = useState<EntryResult[] | null>(null);
  /** Bumped to make the saved list reload. A counter rather than a boolean so two changes in a row
   *  cannot collapse into one render. */
  const [listVersion, setListVersion] = useState(0);
  /** The parish's today, not the browser's. An officer in Manila at 07:00 is not planning yesterday. */
  const [today, setToday] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/masses", { credentials: "same-origin" });
        const body = await res.json().catch(() => ({}));
        setMasses(((body as { data?: { masses?: Mass[] } }).data?.masses ?? []) as Mass[]);
      } catch {
        setError("Could not load the Mass list.");
      }
      // Same list the Templates page writes, so "use a template" means the same thing in both places.
      try {
        const res = await fetch("/api/officer/liturgy-templates", { credentials: "same-origin" });
        if (res.ok) {
          const body = (await res.json()) as { templates?: Template[] };
          setTemplates(body.templates ?? []);
        }
      } catch {
        setTemplates([]);
      }
    })();
    // Falls back to the browser's date only if the parish's cannot be read. Either is far better than
    // opening the dialog on an empty date field.
    fetch("/api/church-date", { credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { data?: { today?: string } };
        return body.data?.today ?? "";
      })
      .catch(() => "")
      .then((value) => setToday(value || new Date().toISOString().slice(0, 10)));
  }, []);

  const addDraft = (draft: AssignmentDraft) => {
    const { drafts: next, replaced } = upsertDraft(drafts, draft);
    setDrafts(next);
    setEditingDraft(null);
    setQueueReport(null);
    const filled = draftFilled(draft);
    const left = draftUnassigned(draft);
    setNotice(
      replaced
        ? "That date and Mass was already on the list, so it was updated rather than added twice."
        : left > 0
          ? `Added ${churchTodayLabel(draft.session_date)} with ${filled} server${
              filled === 1 ? "" : "s"
            }. ${left} position${left === 1 ? " has" : "s have"} nobody yet and will not be saved.`
          : `Added ${churchTodayLabel(draft.session_date)} with ${filled} server${
              filled === 1 ? "" : "s"
            }. Add another, or save the list.`,
    );
  };

  /** Open the dialog on an entry already queued. */
  const editDraft = (draft: AssignmentDraft) => {
    setEditingDraft(draft);
    setModalOpen(true);
  };

  /** Open the dialog on a saved assignment, so a correction can be made before it is written back. */
  const editSaved = (row: SavedAssignment) => {
    const key = `${row.session_date}|${row.mass_id}`;
    setEditingSaved((prev) => new Set(prev).add(key));
    setEditingDraft({
      session_date: row.session_date,
      mass_id: row.mass_id,
      // Empty: a saved roster does not remember which template produced it, and the template is only
      // ever a shortcut for filling the position list in. Choosing one here would overwrite what the
      // officer already has.
      template_id: "",
      announce: row.announced,
      announce_delete_at: row.announcement_delete_at?.slice(0, 10) ?? row.session_date,
      rows: row.slots.map((s) => ({
        key: crypto.randomUUID(),
        position_label: s.position_label,
        member_id: s.member_id ?? "",
        member_name: s.member_name ?? "",
        required_gender: "any" as const,
      })),
    });
    setModalOpen(true);
  };

  const saveDrafts = async () => {
    if (drafts.length === 0) return;
    setSavingQueue(true);
    setError(null);
    setNotice(null);
    setQueueReport(null);
    try {
      const res = await fetch("/api/officer/assign", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: drafts.map((d) => {
            const key = draftKey(d);
            return {
              session_date: d.session_date,
              mass_id: d.mass_id,
              template_id: d.template_id || null,
              announce: d.announce,
              announce_delete_at: d.announce ? d.announce_delete_at : null,
              replace: replaceExisting || editingSaved.has(key),
              slots: draftSlots(d),
            };
          }),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; results?: EntryResult[] };
      if (!res.ok || !body.results) {
        setError(body.error ?? "Could not save the assignments.");
        return;
      }
      const results = body.results;
      setQueueReport(results);
      // Only the entries that went are taken off the list. Dropping the lot would silently discard
      // the ones the server refused, which is the opposite of what pressing Save again expects.
      const saved = new Set(
        results.filter((r) => r.ok).map((r) => `${r.session_date}|${r.mass_id}`),
      );
      setDrafts((prev) => prev.filter((d) => !saved.has(draftKey(d))));
      setEditingSaved((prev) => {
        const next = new Set(prev);
        for (const key of saved) next.delete(key);
        return next;
      });
      // The saved list has to follow, or the officer saves six Sundays and the screen below still
      // says nothing is saved.
      setListVersion((n) => n + 1);

      const added = results.filter((r) => r.ok).length;
      const refused = results.length - added;
      setNotice(
        [
          added > 0 ? `Saved ${added} assignment${added === 1 ? "" : "s"}.` : "Nothing was saved.",
          refused > 0
            ? `${refused} stayed on the list because ${refused === 1 ? "it" : "they"} could not be saved.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch {
      setError("Could not reach the server, so nothing was saved.");
    } finally {
      setSavingQueue(false);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-lg font-semibold sm:text-xl">Assign a server</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Add an assignment, choose the positions, then either draw the servers or pick them yourself.
          Add as many as you like and save them together, and choose per assignment whether it goes out
          as an announcement.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-[var(--text-muted)]">
          {notice}
        </p>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">New assignments</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Nothing is stored until you save.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditingDraft(null);
              setModalOpen(true);
            }}
          >
            Add new assignment
          </Button>
        </div>

        {drafts.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            The list is empty. Add an assignment, then save when you have them all.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {drafts.map((d) => (
              <li
                key={draftKey(d)}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span className="font-medium">{churchTodayLabel(d.session_date)}</span>
                <span className="text-[var(--text-muted)]">
                  {masses.find((m) => m.id === d.mass_id)?.name ?? "Unknown Mass"}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {draftFilled(d)} server{draftFilled(d) === 1 ? "" : "s"}
                  {draftUnassigned(d) > 0 ? `, ${draftUnassigned(d)} unfilled` : ""}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {d.announce
                    ? `Announced until ${churchTodayLabel(d.announce_delete_at)}`
                    : "Saved quietly"}
                </span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => editDraft(d)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDrafts((prev) => prev.filter((x) => draftKey(x) !== draftKey(d)))}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {drafts.length > 0 ? (
          <>
            <label className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
              />
              <span>
                Rebuild any date and Mass that already has servers (leave unticked and they are left
                alone)
              </span>
            </label>

            <div className="mt-3">
              <Button onClick={() => void saveDrafts()} disabled={savingQueue}>
                {savingQueue
                  ? "Saving…"
                  : `Save ${drafts.length} assignment${drafts.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        ) : null}

        {queueReport && queueReport.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {queueReport.map((r) => (
              <li key={`${r.session_date}|${r.mass_id}`} className="text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text)]">
                  {churchTodayLabel(r.session_date)} · {r.mass_name}
                </span>{" "}
                — {r.message}
                {r.announced ? " Announced and a notification sent." : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <NewAssignmentModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          // Closing an edit must not leave the next "Add new assignment" opening on stale values.
          if (!open) setEditingDraft(null);
        }}
        masses={masses}
        templates={templates}
        defaultDate={today}
        draft={editingDraft}
        onSubmit={addDraft}
      />

      <SavedAssignments
        today={today}
        version={listVersion}
        onEdit={editSaved}
        onChanged={() => setListVersion((n) => n + 1)}
      />
    </div>
  );
}