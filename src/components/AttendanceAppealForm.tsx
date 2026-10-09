"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { dataOf, messageOf, readEnvelope } from "@/lib/api/client";

type Member = { id: string; full_name: string };

export function AttendanceAppealForm({
  sessionId,
  onAppealSubmitted,
  onSubmittingChange,
}: {
  sessionId: string;
  /** Called after a successful submit so the parent can refresh roster from the server. */
  onAppealSubmitted?: () => void;
  /** When attendance is being saved, parents can disable navigation (e.g. Back) until the request finishes. */
  onSubmittingChange?: (submitting: boolean) => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<{ title: string; body: string } | null>(null);
  const [cannotAppealIds, setCannotAppealIds] = useState<Set<string>>(new Set());
  /** APL-1: the member's own words, e.g. "Served as thurifer". */
  const [note, setNote] = useState("");
  /** APL-6: null while unknown, so the card does not claim the window is open before it is. */
  const [windowInfo, setWindowInfo] = useState<{ open: boolean; closes_on: string | null } | null>(null);

  const loadAppealRestrictions = useCallback(async () => {
    const res = await fetch(`/api/attendance/session/${sessionId}`, { credentials: "same-origin" });
    if (!res.ok) return;
    const j = (await res.json()) as {
      member_ids_cannot_appeal?: string[];
      appeal_window?: { open: boolean; closes_on: string | null };
    };
    setCannotAppealIds(new Set(j.member_ids_cannot_appeal ?? []));
    if (j.appeal_window) setWindowInfo(j.appeal_window);
  }, [sessionId]);

  useEffect(() => {
    loadAppealRestrictions();
  }, [loadAppealRestrictions]);

  useEffect(() => {
    return () => {
      onSubmittingChange?.(false);
    };
  }, [onSubmittingChange]);

  useEffect(() => {
    if (!saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saving]);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      (async () => {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`, {
          credentials: "same-origin",
        });
        const j = (await res.json()) as { members?: Member[] };
        setResults(j.members ?? []);
      })();
    }, 180);
    return () => clearTimeout(t);
  }, [term]);

  async function submitAppeal() {
    setSaving(true);
    onSubmittingChange?.(true);
    try {
      const member_ids = [...selected.keys()];
      if (member_ids.length === 0) {
        setModal({ title: "No names selected", body: "Add at least one name before submitting." });
        return;
      }
      const res = await fetch(`/api/attendance/session/${sessionId}/appeals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ member_ids, note: note.trim() || null }),
      });
      const env = await readEnvelope<{ auto_approved?: boolean; approved_count?: number }>(res);
      if (!res.ok) {
        setModal({
          title: "Appeal not submitted",
          // Enveloped: the text is at error.message. Reading `error` itself put an object into a
          // field rendered as a React child, which throws "Objects are not valid as a React child"
          // and took the whole form down rather than showing a message.
          body: messageOf(env, "Could not submit appeal."),
        });
        return;
      }
      const j = dataOf(env) ?? {};
      setSelected(new Map());
      setTerm("");
      setResults([]);
      setNote("");
      if (j.auto_approved) {
        setModal({ title: "Appeal approved", body: "Attendance has been updated." });
      } else {
        setModal({ title: "Appeal submitted", body: "Your appeal will be reviewed by the administrator." });
      }
      await loadAppealRestrictions();
      onAppealSubmitted?.();
    } finally {
      setSaving(false);
      onSubmittingChange?.(false);
    }
  }

  const submittingOverlay =
    saving && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-black/50 px-6 backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div
              className="h-10 w-10 shrink-0 rounded-full border-2 border-white/30 border-t-white animate-spin"
              aria-hidden
            />
            <p className="max-w-sm text-center text-base font-medium text-white">
              Recording attendance…
            </p>
            <p className="max-w-sm text-center text-sm text-white/85">Please wait; do not leave this page yet.</p>
          </div>,
          document.body
        )
      : null;

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {submittingOverlay}
      {modal && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
              onClick={() => setModal(null)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-lg font-semibold text-[var(--text)]">{modal.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{modal.body}</p>
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="mt-5 min-h-11 w-full rounded-xl bg-[var(--brand)] text-sm font-semibold text-white"
                >
                  OK
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
      <h2 className="text-sm font-semibold text-[var(--brand-text)]">Attendance appeal</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        If a server is missing in this attendance, add one or more names and submit for review. You cannot appeal
        for someone already on the list or who already has a pending appeal for this Mass. Approved names appear in
        the attendance list above.
      </p>

      {windowInfo ? (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {windowInfo.open ? (
            windowInfo.closes_on ? (
              <>Appeals for this Mass close on {windowInfo.closes_on}.</>
            ) : (
              <>Appeals for this Mass are open with no deadline.</>
            )
          ) : windowInfo.closes_on ? (
            <>Appeals for this Mass closed on {windowInfo.closes_on}.</>
          ) : (
            <>Appeals for this Mass are closed.</>
          )}
        </p>
      ) : null}

      <label className="sr-only" htmlFor={`appeal-note-${sessionId}`}>
        Note for the reviewer (optional)
      </label>
      <textarea
        id={`appeal-note-${sessionId}`}
        className="mt-3 w-full min-h-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm"
        placeholder="Anything the reviewer should know (optional)"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="mt-1 text-right text-xs text-[var(--text-muted)]">{note.trim().length}/200</p>

      <input
        className="mt-3 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4"
        placeholder="Search member name"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <ul className="mt-2 max-h-48 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        {results.map((m) => (
          <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  if (cannotAppealIds.has(m.id)) {
                    setModal({
                      title: "Cannot appeal",
                      body: `${m.full_name} is already on the attendance list or already has a pending appeal for this Mass.`,
                    });
                    return;
                  }
                  setSelected((prev) => {
                    const n = new Map(prev);
                    n.set(m.id, m.full_name);
                    return n;
                  });
                  setTerm("");
                  setResults([]);
                }}
                className="min-h-11 w-full px-4 text-left text-sm active:bg-[var(--surface-2)]"
              >
              {m.full_name}
            </button>
          </li>
        ))}
        {term.trim().length > 0 && results.length === 0 ? (
          <li className="px-4 py-3 text-sm text-[var(--text-muted)]">No results</li>
        ) : null}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        {[...selected.entries()].map(([id, name]) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-3 py-2 text-sm">
            {name}
            <button
              type="button"
              className="ml-1 font-bold text-[var(--danger-text)]"
              onClick={() =>
                setSelected((prev) => {
                  const n = new Map(prev);
                  n.delete(id);
                  return n;
                })
              }
              aria-label={`Remove ${name}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={submitAppeal}
        disabled={saving || selected.size === 0 || (windowInfo !== null && !windowInfo.open)}
        className="mt-3 min-h-12 w-full rounded-xl bg-[var(--brand)] font-semibold text-white disabled:opacity-40"
      >
        {saving ? "Submitting..." : "Submit appeal"}
      </button>
    </section>
  );
}
