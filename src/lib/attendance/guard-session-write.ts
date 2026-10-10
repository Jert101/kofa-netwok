import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { canEncodeSession } from "@/lib/attendance/future-session";
import { reportLocked, sessionInFuture } from "@/lib/api/response";
import { guardReportNotGenerated } from "@/lib/reports/check-report-lock";
import { UNDEFINED_COLUMN } from "@/lib/supabase/migration-error";
import { getSetting } from "@/lib/settings/store";

/**
 * The one check every attendance write has to pass.
 *
 * Two rules, in this order:
 *
 * 1. Is the month locked by a report? If so, nothing can be written, ever, by
 *    anybody. A rejected report does not lock (see report-lock.ts).
 * 2. Has the Mass happened yet? You cannot record who was there for a Mass that has
 *    not run.
 *
 * Lock comes first because it is the stronger promise: even if a Mass were somehow
 * dated in the past, a locked month stays read-only.
 *
 * Each attendance route calls this rather than repeating the two guards, because
 * forgetting one in a new route is how a locked month quietly becomes editable
 * again.
 */

export type SessionWriteContext = {
  sb: SupabaseClient;
  sessionId: string;
  /** Set false for admin repairs on a locked month, which the spec allows. */
  enforceLock?: boolean;
  /**
   * A notes-only edit. Skips the future-date check, because a note can be written
   * about a Mass that has not run — that is how the secretary records what was
   * planned. It still respects the month lock.
   */
  notesOnly?: boolean;
};

export type SessionForWrite = {
  id: string;
  session_date: string;
  /**
   * `null` for a gathering -- a meeting or a training day, which has no Mass.
   *
   * It was typed `string` before migration 041, which was a lie the moment `mass_id` became nullable:
   * a gathering returned `null as string` and every caller that used it as a Mass id went on to build
   * "undefined" into a label, a key or a delete. Making it `string | null` puts the question at every
   * call site instead of one runtime error per use.
   */
  mass_id: string | null;
  /** What a non-Mass gathering was called. Null for a Mass. */
  title: string | null;
};

export async function loadSessionForWrite(
  sb: SupabaseClient,
  sessionId: string,
): Promise<SessionForWrite | { missing: true }> {
  // Resilient like the other session reads: a pre-041 database holds Masses only, so the fallback
  // loses nothing -- and without it every attendance write in the app would 500 until the migration
  // lands, because they all pass through this guard.
  const { data, error } = await selectSessionsResilient<Record<string, unknown>>(
    (columns) => sb.from("attendance_sessions").select(columns).eq("id", sessionId).maybeSingle(),
    "id, session_date, mass_id, title",
    "id, session_date, mass_id",
  );

  if (error) throw new Error(error.message);
  if (!data) return { missing: true };
  return {
    id: data.id as string,
    session_date: data.session_date as string,
    mass_id: (data.mass_id as string | null) ?? null,
    title: (data.title as string | null) ?? null,
  };
}

/**
 * What this session should be called on screen.
 *
 * The Mass's name for a Mass, the title for a gathering. Used by the day view, the session heading, the
 * appeal queue and the notification label, so that a meeting never appears as "Mass" or as
 * "undefined" -- the two things that actually happen when each of those builds the string itself.
 */
export function sessionLabel(session: {
  massName?: string | null;
  mass_id?: string | null;
  title?: string | null;
}): string {
  if (session.mass_id) return session.massName?.trim() || "Mass";
  return session.title?.trim() || "Meeting";
}

type SessionQueryError = { code?: string | null; message?: string } | null;

/**
 * Run a session-list select that names `title`, falling back when the database predates it.
 *
 * `title` arrived with migration 041 on a table that already existed, and PostgREST answers a select
 * naming a column it does not have with 42703 -- which fails the whole read rather than dropping the
 * one field. Without this, deploying the code before the migration takes down the day view, the
 * session screen and both dashboards on a database where gatherings cannot even exist yet.
 *
 * The fallback is safe precisely because of that: pre-041 every row is a Mass, so `title` is absent
 * rather than blank and every caller already reads it as `(s.title ?? null)`. Same precedent as the
 * `priest_role` retry in `profile-server`.
 */
export async function selectSessionsResilient<T>(
  // `PromiseLike<unknown>` deliberately: a PostgREST filter builder is thenable but its resolved union
  // type does not satisfy a narrower `PromiseLike`, and pinning this to the builder's generics would
  // couple every caller to postgrest-js internals. The single cast below is the only untyped moment,
  // and every caller still names its own row type explicitly.
  run: (columns: string) => PromiseLike<unknown>,
  columnsWithTitle: string,
  columnsWithoutTitle: string,
): Promise<{ data: T | null; error: SessionQueryError }> {
  type Result = { data: T | null; error: SessionQueryError };
  const first = (await run(columnsWithTitle)) as Result;
  if (!first.error || first.error.code !== UNDEFINED_COLUMN) return first;
  return (await run(columnsWithoutTitle)) as Result;
}

/**
 * Returns a response to send back, or null when the write may proceed.
 *
 * A null return meaning "go ahead" reads oddly, but it keeps every call site to
 * three lines and makes the guard impossible to forget at the end of a route.
 */
export async function guardSessionWrite(
  { sb, sessionId, enforceLock = true, notesOnly = false }: SessionWriteContext,
): Promise<NextResponse | null> {
  const session = await loadSessionForWrite(sb, sessionId);
  if ("missing" in session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (enforceLock) {
    const guard = await guardReportNotGenerated(sb, session.session_date);
    if (guard.blocked) {
      return reportLocked(guard.message ?? "Attendance is read-only for this month.");
    }
  }

  if (notesOnly) return null;

  const timeZone = await getSetting("report_timezone");
  const future = canEncodeSession(session.session_date, new Date(), timeZone);
  if (!future.allowed) {
    return sessionInFuture(future.message);
  }

  return null;
}
