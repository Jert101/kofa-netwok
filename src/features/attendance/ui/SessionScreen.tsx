"use client";

/**
 * ATT-4: one session screen, used by every role.
 *
 * The four old pages (admin, secretary, officer, member) each had their own copy of
 * the session, which is why a fix to the roster had to be made four times and two of
 * them had drifted. This component takes the role as a prop and renders what that
 * role may do, so there is one place where a rule like "a locked month is
 * read-only" can exist.
 *
 * What each role gets, per the spec:
 *
 *   admin, secretary — editable roster, appeals review, liturgy summary
 *   officer          — liturgy editor, roster read-only
 *   member           — liturgy servers, roster read-only
 *
 * The roster's editable flag is decided by the server and mirrored here. Read-only is
 * the default for a role the screen does not recognise, because failing to hide a
 * control is worse than hiding one that should have been there.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Lock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Roster, type RosterEntry } from "@/features/attendance/ui/Roster";
import { AttendanceAppealsReview } from "@/components/AttendanceAppealsReview";
import { AttendanceAppealForm } from "@/components/AttendanceAppealForm";
import { MyAppealsList } from "@/features/appeals/ui/MyAppealsList";
import { LiturgyPlanner } from "@/features/liturgy/ui/LiturgyPlanner";
import { decideEditability } from "@/lib/attendance/editability";
import type { Role } from "@/lib/auth/roles";

type SessionPayload = {
  session: {
    id: string;
    session_date: string;
    /**
     * Null for a gathering. The server sends it through rather than coercing it, so the screen can
     * decide what applies to a meeting -- and the liturgy editor is hidden for one on this basis rather
     * than on an empty server list, which is also what a Mass with nobody assigned yet looks like.
     */
    mass_id: string | null;
    title: string | null;
    mass_name: string;
    /** False for a gathering: no Mass means no servers were assigned and none can be. */
    has_liturgy: boolean;
    notes: string | null;
  };
  roster: RosterEntry[];
  members: { member_id: string; full_name: string }[];
  liturgy_servers: {
    id: string;
    position_label: string;
    member_id: string | null;
    member_name: string | null;
    free_text: string | null;
    sort_order: number;
  }[];
  /** The version of `liturgy_servers`, so the editor's save sends a real `expected_version`. */
  liturgy_version?: string | null;
  locked: boolean;
  locked_reason: "pending_approval" | "approved" | null;
  locked_message: string | null;
  is_future: boolean;
  month_label: string;
  /** APL-4: present only for a member with a declared identity. */
  my_appeals?: {
    id: string;
    status: "pending" | "approved" | "rejected" | "expired";
    resolution: string | null;
    reject_reason: string | null;
    reviewed_at: string | null;
    submitted_at: string;
    note: string | null;
  }[];
};

type Props = {
  sessionId: string;
  role: Role;
  /** Where to go when the session is deleted or the user backs out. */
  backHref: string;
};

export function SessionScreen({ sessionId, role, backHref }: Props) {
  const router = useRouter();
  const [data, setData] = useState<SessionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Inline, not modal: a failed note must not interrupt someone mid-encode. */
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesSaved, setNotesSaved] = useState(false);
  const [version, setVersion] = useState(0);

  const canEncode = role === "admin" || role === "secretary";
  const canDelete = role === "admin";
  const canReviewAppeals = canEncode;
  const canEditLiturgy = canEncode || role === "officer";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/session/${sessionId}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        // This route answers with bare JSON, so the reason is under `error`. Reading it means a real
        // server-side failure says what went wrong instead of a generic message that sends the
        // secretary looking for a problem that is not on their side.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setLoadError(
          res.status === 404
            ? "That session no longer exists."
            : body?.error ?? "Could not load this session.",
        );
        return;
      }
      setData((await res.json()) as SessionPayload);
      setLoadError(null);
    } catch {
      setLoadError("Could not reach the server.");
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const editability = useMemo(() => {
    if (!data) return { editable: false, banner: null } as const;
    const decision = decideEditability({
      locked: data.locked,
      lockReason: data.locked_reason,
      lockMonthLabel: data.month_label,
      isFuture: data.is_future,
    });
    // Even when the server says the month is fine, a role that may not encode gets a
    // read-only roster. The server is still the one that rejects the write.
    return canEncode ? decision : { editable: false, banner: decision.banner };
  }, [data, canEncode]);

  const saveNotes = useCallback(
    async (notes: string) => {
      setNotesError(null);
      try {
        const res = await fetch(`/api/attendance/session/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ notes }),
        });
        // The status was never checked, so a 401, a 409 from the month lock, or a 500 all looked
        // exactly like a save. The field kept what was typed and nobody was told: the secretary
        // walked away believing the note was on the record. Saying so inline keeps the original
        // intent -- a note is not worth interrupting an encoding session over -- while making the
        // failure something a person can see and retry.
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setNotesError(body?.error ?? "That note was not saved.");
          return;
        }
        setNotesSaved(true);
      } catch {
        setNotesError("That note was not saved. Check your connection and try again.");
      }
    },
    [sessionId],
  );

  const removeSession = useCallback(async () => {
    if (!confirm("Delete this session? Only possible when nothing is recorded in it.")) return;
    const res = await fetch(`/api/attendance/session/${sessionId}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setLoadError(body?.error ?? "Could not delete this session.");
      return;
    }
    router.replace(backHref);
  }, [sessionId, router, backHref]);

  if (loadError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--danger)]">{loadError}</p>
        <Button type="button" variant="outline" onClick={() => router.replace(backHref)}>
          ← Back
        </Button>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={() => router.back()}>
          ← Back
        </Button>
        <h1 className="mt-1 text-xl font-semibold">{data.session.mass_name}</h1>
        <p className="text-sm text-[var(--text-muted)]">{data.session.session_date}</p>
      </div>

      {editability.banner ? <Banner banner={editability.banner} /> : null}

      {/*
        APL-1 puts the appeal card first. A server being missing from the roster is the main reason a
        member opens this page, and it used to wait for the whole attendance table to scroll past --
        the part of the screen where a missing name lives was exactly the part the member's eye read
        last. The outcomes of appeals they already sent sit right under it.
      */}
      {role === "member" ? (
        <AttendanceAppealForm sessionId={sessionId} onAppealSubmitted={refresh} />
      ) : null}

      {role === "member" && data.my_appeals?.length ? (
        <MyAppealsList appeals={data.my_appeals} />
      ) : null}

      <Roster
        sessionId={sessionId}
        roster={data.roster}
        editable={editability.editable}
        notes={data.session.notes}
        onNotesSave={(notes) => void saveNotes(notes)}
        notesError={notesError}
        notesSaved={notesSaved}
        onRefresh={refresh}
        externalVersion={version}
      />

      {canReviewAppeals ? (
        <AttendanceAppealsReview sessionId={sessionId} onAppealApproved={refresh} />
      ) : null}

      {data.session.has_liturgy && canEditLiturgy ? (
        // LIT-1's editor, shown even when nothing is assigned yet: an officer filling in who is
        // free is the common case for a session that has no liturgy servers on it. Hidden entirely for
        // a gathering -- there a blank server list would read as the ministry having assigned nobody.
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Liturgy servers</h2>
          <LiturgyPlanner
            target={{ kind: "session", sessionId }}
            title="Serving today"
            subtitle={data.session.mass_name}
            initialRows={data.liturgy_servers}
            initialVersion={data.liturgy_version ?? null}
            onSaved={refresh}
          />
        </section>
      ) : null}

      {data.session.has_liturgy && !canEditLiturgy && data.liturgy_servers.length ? (
        <section>
          <h2 className="text-sm font-semibold text-[var(--text-muted)]">Liturgy servers</h2>
          <ul className="mt-2 divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)]">
            {data.liturgy_servers.map((server) => (
              <li key={server.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm text-[var(--text-muted)]">{server.position_label}</span>
                <span className="text-base">{server.member_name ?? server.free_text ?? "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canDelete ? (
        <Button
          type="button"
          variant="outline"
          className="w-full text-[var(--danger)]"
          onClick={() => void removeSession()}
        >
          <Trash2 aria-hidden />
          Delete this session
        </Button>
      ) : null}
    </div>
  );
}

function Banner({ banner }: { banner: { tone: "locked" | "future"; title: string; body: string } }) {
  const Icon = banner.tone === "locked" ? Lock : AlertTriangle;
  return (
    <div
      role="status"
      className="flex gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4"
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--text-muted)]" />
      <div className="text-sm">
        <p className="font-semibold">{banner.title}</p>
        <p className="mt-1 text-[var(--text-muted)]">{banner.body}</p>
      </div>
    </div>
  );
}
