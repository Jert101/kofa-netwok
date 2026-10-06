"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { BulkAssign } from "./BulkAssign";
import { NewAssignmentModal } from "./NewAssignmentModal";
import { SavedAssignments } from "./SavedAssignments";
import { MemberCombobox, type MemberHit } from "@/components/MemberCombobox";
import { draftKey, upsertDraft, type AssignmentDraft } from "@/lib/liturgy/assign-batch";
import { churchTodayLabel } from "@/lib/time/church-time-labels";

/** `is_active` is kept because the "add new assignment" modal offers only the active ones. The Mass
 *  dropdown lower down still lists every Mass, because a roster that was set before a Mass was
 *  switched off is still a roster somebody has to be able to open and fix. */
type Mass = { id: string; name: string; is_active?: boolean };
type Template = { id: string; name: string; slot_count?: number };

type EntryResult = {
  session_date: string;
  mass_id: string;
  mass_name: string;
  ok: boolean;
  saved: number;
  unfilled: number;
  announced: boolean;
  announcement_id: string | null;
  message: string;
};
/** `required_gender` is the criterion the random fill uses for a position. It is a tool for choosing,
 *  not a property of the assignment, so it is never sent to the server. */
type Row = {
  key: string;
  position_label: string;
  member_id: string;
  member_name: string;
  required_gender?: "male" | "female" | "any";
};

/**
 * Assign a server, by date and by Mass.
 *
 * Pick a date and a Mass and the list below is exactly what will be saved for that date+Mass. A
 * template can seed the position list: choosing one brings in its positions, keeps anyone already
 * assigned to a matching position, and leaves the rest for you to fill. Positions with no server yet
 * are shown so you can finish them, but the save only writes the ones that have a server — the
 * endpoint this page uses requires a member on every row it stores.
 *
 * The "push to notifications" switch tells the server whether to tell the parish about the change.
 */
export default function OfficerAssignPage() {
  const [date, setDate] = useState("");
  const [masses, setMasses] = useState<Mass[]>([]);
  const [massId, setMassId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sendPush, setSendPush] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");

  const [newPosition, setNewPosition] = useState("");
  const [newMember, setNewMember] = useState<MemberHit | null>(null);

  // The queue: assignments added through the modal and not yet written.
  const [drafts, setDrafts] = useState<AssignmentDraft[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  /** The queue entry the modal is editing, or null when it is adding. */
  const [editingDraft, setEditingDraft] = useState<AssignmentDraft | null>(null);
  const [savingQueue, setSavingQueue] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [queueReport, setQueueReport] = useState<EntryResult[] | null>(null);
  /** Bumped to make the saved list reload; a counter rather than a boolean so two changes in a row
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
      // Same list the plan editor uses, so "use a template" means the same thing on both screens.
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
    // Fall back to the browser's date only if the parish's cannot be read. Both are far better than
    // opening the modal on an empty date field.
    fetch("/api/church-date", { credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { data?: { today?: string } };
        return body.data?.today ?? "";
      })
      .catch(() => "")
      .then((value) => {
        const day = value || new Date().toISOString().slice(0, 10);
        setToday(day);
        setDate((d) => d || day);
      });
  }, []);

  const addDraft = (draft: AssignmentDraft) => {
    const wasEditing = editingDraft !== null;
    const { drafts: next, replaced } = upsertDraft(drafts, draft);
    setDrafts(next);
    setEditingDraft(null);
    setQueueReport(null);
    setNotice(
      replaced
        ? "That date and Mass was already on the list, so it was updated rather than added twice."
        : `Added ${churchTodayLabel(draft.session_date)}. Add another, or save the list.`,
    );
    // Nothing else to say after an edit that landed where it was expected to.
    if (wasEditing && !replaced) setNotice(`Updated ${churchTodayLabel(draft.session_date)}.`);
  };

  /** Open the modal on an entry already queued. */
  const editDraft = (draft: AssignmentDraft) => {
    setEditingDraft(draft);
    setModalOpen(true);
  };

  /** Load a saved assignment into the hand-pick editor further down. */
  const editRoster = (sessionDate: string, mass: string) => {
    setDate(sessionDate);
    setMassId(mass);
    setRows(null);
    setNotice(`Editing ${churchTodayLabel(sessionDate)}. Change a row and save it below.`);
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
          assignments: drafts.map((d) => ({
            session_date: d.session_date,
            mass_id: d.mass_id,
            template_id: d.template_id,
            announce: d.announce,
            announce_delete_at: d.announce ? d.announce_delete_at : null,
            replace: replaceExisting,
          })),
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
      // the ones the server refused, which is the opposite of what an officer pressing Save again
      // expects to happen.
      const saved = new Set(
        results.filter((r) => r.ok).map((r) => `${r.session_date}|${r.mass_id}`),
      );
      setDrafts((prev) => prev.filter((d) => !saved.has(draftKey(d))));
      // The saved list has to follow, or the officer saves six Sundays and the screen below still
      // says nothing is saved.
      setListVersion((n) => n + 1);
      const added = results.filter((r) => r.ok).length;
      const refused = results.length - added;
      setNotice(
        [
          added > 0 ? `Saved ${added} assignment${added === 1 ? "" : "s"}.` : "Nothing was saved.",
          refused > 0 ? `${refused} stayed on the list because ${refused === 1 ? "it" : "they"} could not be saved.` : "",
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

  const loadAssignments = useCallback(async () => {
    if (!date || !massId) {
      setRows([]);
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/attendance/liturgy-planned?date=${encodeURIComponent(date)}&mass_id=${encodeURIComponent(massId)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        setError("Could not load the assignment for that date and Mass.");
        setRows(null);
        return;
      }
      const body = (await res.json()) as {
        slots?: Array<{ position_label: string; member_id: string; member_name?: string | null }>;
      };
      setRows(
        (body.slots ?? []).map((s, i) => ({
          key: `${s.position_label}-${s.member_id}-${i}`,
          position_label: s.position_label,
          member_id: s.member_id,
          member_name: (s.member_name ?? "").trim() || "Member",
        })),
      );
    } catch {
      setError("Could not load the assignment for that date and Mass.");
      setRows(null);
    }
  }, [date, massId]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const addRow = () => {
    if (!newPosition.trim() || !newMember) return;
    setRows((prev) => [
      ...(prev ?? []),
      {
        key: crypto.randomUUID(),
        position_label: newPosition.trim(),
        member_id: newMember.id,
        member_name: newMember.full_name,
      },
    ]);
    setNewPosition("");
    setNewMember(null);
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev ?? []).filter((r) => r.key !== key));
  };

  const patchRow = (key: string, patch: Partial<Row>) => {
    setRows((prev) => (prev ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  /**
   * Randomly fill the positions that have a name but no server yet -- the ones a template just brought
   * in, typically. Each empty row is filled from the active roll filtered by that row's gender rule
   * ("Anyone" takes anyone), and a member who is already serving somewhere on this date+Mass, or who
   * was just drawn for another row, is never picked twice.
   *
   * Like the plan editor, this only edits the rows on screen: nothing is stored until Save, so the
   * officer reviews the draw first and the push-notification choice still governs the save.
   */
  const randomFillEmpty = async () => {
    const current = rows ?? [];
    const targets = current.filter((r) => !r.member_id && r.position_label.trim().length > 0);
    if (targets.length === 0) {
      setNotice("Every named position already has a server, so there is nothing to fill.");
      return;
    }

    setError(null);
    let members: Array<{ id: string; full_name: string; gender: string | null }>;
    try {
      const res = await fetch("/api/admin/members?status=active&page_size=100", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        data?: { members?: Array<{ id: string; full_name: string; gender?: string | null }> };
      };
      members = (body.data?.members ?? []).map((m) => ({
        id: String(m.id),
        full_name: String(m.full_name ?? ""),
        gender: m.gender ?? null,
      }));
    } catch {
      setError("Could not load the member list, so nothing was assigned.");
      return;
    }

    const usedNow = new Set(current.map((r) => r.member_id).filter((id): id is string => Boolean(id)));
    let filled = 0;
    let short = 0;

    const next = current.map((r) => {
      if (r.member_id || r.position_label.trim().length === 0) return r;
      const rule = r.required_gender ?? "any";
      const pool = members.filter((m) => {
        if (usedNow.has(m.id)) return false;
        if (rule === "any") return true;
        return (m.gender ?? "").toLowerCase() === rule;
      });
      if (pool.length === 0) {
        short += 1;
        return r;
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      usedNow.add(pick.id);
      filled += 1;
      return { ...r, member_id: pick.id, member_name: pick.full_name };
    });

    setRows(next);
    setNotice(
      short > 0
        ? `Assigned ${filled} server${filled === 1 ? "" : "s"}; ${short} position${short === 1 ? "" : "s"} had no eligible member left and ${short === 1 ? "stays" : "stay"} unassigned. Review them, then save.`
        : `Filled ${filled} position${filled === 1 ? "" : "s"}. Review them, then save.`,
    );
  };

  /**
   * Seed the list from a template. Anyone already assigned to a position that the template also names
   * keeps their server; the template's other positions arrive empty and wait to be filled. Non
   * template rows already on screen are left alone rather than wiped.
   */
  const applyTemplate = async () => {
    if (!templateId) return;
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(templateId)}`, {
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => ({}))) as {
        name?: string;
        position_labels?: string[];
      };
      if (!res.ok) {
        setNotice(body && "error" in body ? String((body as { error: string }).error) : "Could not load that template.");
        return;
      }
      const labels = (body.position_labels ?? []).map((l) => l.trim()).filter(Boolean);
      if (labels.length === 0) {
        setNotice("That template has no positions in it.");
        return;
      }
      setRows((prev) => {
        const current = prev ?? [];
        const next = [...current];
        for (const label of labels) {
          const already = current.some(
            (r) => r.position_label.trim().toLowerCase() === label.toLowerCase(),
          );
          if (!already) {
            next.push({
              key: crypto.randomUUID(),
              position_label: label,
              member_id: "",
              member_name: "",
            });
          }
        }
        return next;
      });
      setNotice(`Added ${body.name ?? "the template"}'s positions. Give each one a server, then save.`);
    } catch {
      setNotice("Could not load that template.");
    }
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    const slots = (rows ?? [])
      .filter((r) => r.position_label.trim() && r.member_id)
      .map((r) => ({ position_label: r.position_label.trim(), member_id: r.member_id }));
    const res = await fetch("/api/attendance/liturgy-planned", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_date: date, mass_id: massId, slots, send_push: sendPush }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not save the assignment.");
      return;
    }
    setNotice(
      sendPush
        ? "Assignment saved and a notification was sent."
        : "Assignment saved quietly (no notification).",
    );
    await loadAssignments();
  };

  const clearAll = async () => {
    if (!date || !massId) return;
    if (!window.confirm("Remove every assigned server for that date and Mass? This cannot be undone.")) return;
    setError(null);
    setNotice(null);
    const res = await fetch(
      `/api/attendance/liturgy-planned?date=${encodeURIComponent(date)}&mass_id=${encodeURIComponent(massId)}`,
      { method: "DELETE", credentials: "same-origin" },
    );
    if (!res.ok) {
      setError("Could not clear the assignment.");
      return;
    }
    setRows([]);
    setNotice("Cleared the assignment for that date and Mass.");
  };

  const list = rows ?? [];
  const loading = rows === null && date && massId;
  const unassigned = list.filter((r) => !r.member_id).length;

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-lg font-semibold sm:text-xl">Assign a server</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Add an assignment for a date and Mass, and the template fills the positions and draws the
          servers. Add as many as you like, then save the lot — and choose per assignment whether it
          goes out as an announcement. Further down you can still hand-pick one Mass, or fill a whole
          date range.
        </p>
      </header>

      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-[var(--text-muted)]">{notice}</p> : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">New assignments</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Nothing is stored until you save. Servers are drawn once per date, so two Masses on one
              Sunday never get the same person.
            </p>
          </div>
          <Button onClick={() => setModalOpen(true)}>Add new assignment</Button>
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
                <span className="text-[var(--text-muted)]">
                  from {templates.find((t) => t.id === d.template_id)?.name ?? "a template"}
                </span>
                <span className="ml-auto text-xs text-[var(--text-muted)]">
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
        defaultDate={today || date}
        draft={editingDraft}
        onAdd={addDraft}
      />

      <SavedAssignments
        today={today}
        version={listVersion}
        onEditRoster={editRoster}
        onChanged={() => setListVersion((n) => n + 1)}
      />

      <h2 className="text-sm font-medium text-[var(--brand)]">Hand-pick one Mass</h2>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-[var(--text-muted)]">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setRows(null);
            }}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--text-muted)]">Mass</span>
          <select
            value={massId}
            onChange={(e) => {
              setMassId(e.target.value);
              setRows(null);
            }}
            className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          >
            <option value="">Choose a Mass…</option>
            {masses.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {templates.length > 0 ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-medium">Use a template</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Brings in the positions from a saved template. Anyone already assigned to a position that
            the template names keeps their server.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => void applyTemplate()} disabled={!templateId}>
              Use template
            </Button>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-medium">
          Positions for {masses.find((m) => m.id === massId)?.name ?? "that Mass"}
        </h2>

        {loading ? <p className="mt-3 text-sm text-[var(--text-muted)]">Loading…</p> : null}
        {!loading && list.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            No servers are assigned yet. Add one below, or start from a template.
          </p>
        ) : null}

        {list.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {list.map((r) => (
              <li
                key={r.key}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2"
              >
                <input
                  value={r.position_label}
                  onChange={(e) => patchRow(r.key, { position_label: e.target.value })}
                  placeholder="Position"
                  aria-label="Position"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
                />
                <div className="min-w-0 flex-1">
                  <MemberCombobox
                    value={r.member_id ? { id: r.member_id, full_name: r.member_name } : null}
                    onChange={(m) =>
                      patchRow(r.key, { member_id: m?.id ?? "", member_name: m?.full_name ?? "" })
                    }
                  />
                </div>
                {!r.member_id ? (
                  <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <span className="sr-only">{r.position_label || "This position"} should prefer</span>
                    <select
                      value={r.required_gender ?? "any"}
                      onChange={(e) =>
                        patchRow(r.key, { required_gender: e.target.value as "male" | "female" | "any" })
                      }
                      aria-label={`Auto-assign preference for ${r.position_label || "this position"}`}
                      className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
                    >
                      <option value="any">Anyone</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </label>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => removeRow(r.key)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {unassigned > 0 ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {unassigned} position{unassigned === 1 ? " has" : "s have"} no server yet. Only positions
            with a server are saved.
          </p>
        ) : null}

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={newPosition}
              onChange={(e) => setNewPosition(e.target.value)}
              placeholder="Position (e.g. Thurifer)"
              className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
            />
            <MemberCombobox value={newMember} onChange={setNewMember} />
            <Button size="sm" onClick={addRow} disabled={!newPosition.trim() || !newMember}>
              Add
            </Button>
          </div>
        </div>
      </section>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sendPush} onChange={(e) => setSendPush(e.target.checked)} />
        <span>Push a notification to members about this assignment</span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={!massId || !date}>
          Save assignment
        </Button>
        <Button variant="outline" onClick={() => void randomFillEmpty()} disabled={unassigned === 0}>
          Auto-assign empty rows
        </Button>
        <Button variant="outline" onClick={() => void clearAll()} disabled={!massId || !date}>
          Clear all
        </Button>
      </div>

      <BulkAssign masses={masses} sendPush={sendPush} />
    </div>
  );
}
