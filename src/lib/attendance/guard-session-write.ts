import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { canEncodeSession } from "@/lib/attendance/future-session";
import { reportLocked, sessionInFuture } from "@/lib/api/response";
import { guardReportNotGenerated } from "@/lib/reports/check-report-lock";
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

export async function loadSessionForWrite(
  sb: SupabaseClient,
  sessionId: string,
): Promise<{ id: string; session_date: string; mass_id: string } | { missing: true }> {
  const { data, error } = await sb
    .from("attendance_sessions")
    .select("id, session_date, mass_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { missing: true };
  return {
    id: data.id as string,
    session_date: data.session_date as string,
    mass_id: data.mass_id as string,
  };
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
