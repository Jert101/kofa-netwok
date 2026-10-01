import { NextRequest } from "next/server";
import { endOfMonth, format as formatDate } from "date-fns";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { decideReportLock, monthLabel } from "@/lib/reports/report-lock";
import { needsEncoding } from "@/lib/attendance/calendar-indicators";
import { getSetting } from "@/lib/settings/store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const qSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export type DayIndicator = {
  date: string;
  /** Sessions on that day. */
  sessions: number;
  /** Sessions with at least one attendance record, live or archived. */
  held: number;
  /** Present count summed across the day's sessions. */
  present: number;
  /** Past days that have sessions but nobody encoded yet. */
  needs_encoding: boolean;
  /** Open appeals, secretary and admin only. */
  pending_appeals: number;
};

/**
 * ATT-3 month calendar, one request per month.
 *
 * Deliberately sends one flag per day rather than the session list. The calendar only
 * needs to know what to draw; the day view fetches the sessions when a day is actually
 * opened. On a phone, sending every session of every Mass for thirty days to render
 * forty numbers nobody looks at is the wrong trade.
 *
 * `held` counts a session as held when it has at least one attendance record. An empty
 * session does not count towards the month's figures (per the report rule), so the
 * calendar must agree or it will contradict the numbers beside it.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["member", "secretary", "admin", "officer"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = qSchema.safeParse({ month: url.searchParams.get("month") });
  if (!parsed.success) {
    return internalError("Invalid month.");
  }

  const month = parsed.data.month;
  const start = `${month}-01`;
  const end = formatDate(endOfMonth(new Date(`${month}-01T12:00:00`)), "yyyy-MM-dd");
  // Parishes are ahead of UTC, so "today" has to be the parish's today. Using the
  // server's date would mark the wrong day around midnight and make a finished day
  // look like it still needs encoding.
  const today = todayInParish(await getSetting("report_timezone"));

  const sb = getSupabaseAdmin();

  try {
    const { data: sessions, error: sessionError } = await sb
      .from("attendance_sessions")
      .select("id, session_date, attendance_records(count)")
      .gte("session_date", start)
      .lte("session_date", end);

    if (sessionError) throw new Error(sessionError.message);

    const days = new Map<string, { sessions: number; held: number; present: number }>();
    for (const row of sessions ?? []) {
      const date = String(row.session_date);
      const counts = (row.attendance_records as { count?: number }[] | null) ?? [];
      const present = counts.reduce((sum, c) => sum + (c.count ?? 0), 0);
      const entry = days.get(date) ?? { sessions: 0, held: 0, present: 0 };
      entry.sessions += 1;
      // Merged live and archived: a session whose records all live in the archive still
      // counts as held, otherwise old months show up as "needs encoding" forever.
      if (present > 0) entry.held += 1;
      entry.present += present;
      days.set(date, entry);
    }

    const showAppeals = g.session.role === "secretary" || g.session.role === "admin";
    const appealsByDate = showAppeals ? await pendingAppealsByDate(sb, start, end) : new Map<string, number>();

    const indicators: DayIndicator[] = [...days.entries()]
      .map(([date, counts]) => ({
        date,
        sessions: counts.sessions,
        held: counts.held,
        present: counts.present,
        needs_encoding: needsEncoding(date, { sessions: counts.sessions, held: counts.held }, today),
        pending_appeals: appealsByDate.get(date) ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // The lock is a property of the month, not of a day, so it is reported once rather
    // than repeated on thirty rows. The calendar draws it on every day cell.
    const lock = await monthLock(sb, start);

    return jsonOk({
      month,
      today,
      locked: lock.locked,
      locked_message: lock.locked
        ? `The ${monthLabel(start)} report is closed. Attendance cannot be changed.`
        : null,
      indicators,
    });
  } catch (e) {
    console.error("[attendance/month-indicators] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}

async function monthLock(
  sb: ReturnType<typeof getSupabaseAdmin>,
  monthStart: string,
): Promise<{ locked: boolean }> {
  const { data, error } = await sb
    .from("reports")
    .select("status")
    .eq("report_month", monthStart)
    .maybeSingle();

  // Unreadable reports means the month cannot be promised open, so it is shown locked.
  // A calendar that wrongly says "closed" costs the secretary a retry; one that wrongly
  // says "open" invites edits to a month that will not save.
  if (error) {
    console.error("[attendance/month-indicators] report lock read failed:", error.message);
    return { locked: true };
  }

  return { locked: decideReportLock(data?.status ?? null, monthStart).locked };
}

async function pendingAppealsByDate(
  sb: ReturnType<typeof getSupabaseAdmin>,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const { data, error } = await sb
    .from("attendance_appeals")
    .select("session_id, attendance_sessions!inner(session_date)")
    .eq("status", "pending")
    .gte("attendance_sessions.session_date", start)
    .lte("attendance_sessions.session_date", end);

  if (error) throw new Error(error.message);

  const dates = new Map<string, number>();
  for (const row of data ?? []) {
    // PostgREST returns an embedded relation as an array even when the filter makes it
    // a single row, so the first element is the session.
    const sessions = row.attendance_sessions as unknown as { session_date: string }[];
    const date = String(sessions?.[0]?.session_date ?? "");
    if (date) dates.set(date, (dates.get(date) ?? 0) + 1);
  }
  return dates;
}

function todayInParish(timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // An unusable timezone must not blank the calendar; UTC keeps the grid working
    // even though "today" may be off by a day for a parish east of Greenwich.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}
