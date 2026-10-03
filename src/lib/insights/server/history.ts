/**
 * DSH-6's only database reader.
 *
 * Every metric in the app goes through this file, which goes through `metrics.ts`. That is the whole
 * point of DSH-6: the numbers on a dashboard card, on a member's profile and in a printed report are
 * three questions about the same history, and they used to have four different queries behind them.
 *
 * ## Caching
 *
 * A five-minute TTL per key, in module memory, because module 10's brief asks for five minutes and the
 * alternative -- `unstable_cache` plus tag invalidation wired into every attendance, appeal and report
 * write -- is a lot of moving parts to keep a dashboard from being a second of work on every page load.
 *
 * `invalidateDashboards()` is exported and called from the write paths, so a mark recorded this morning
 * shows up on the dashboard immediately rather than up to five minutes later. The TTL is the floor
 * behind that, not the mechanism.
 *
 * The cache is per server instance and unbounded, so it is capped and the oldest entries are dropped
 * when it is full. A dashboard that keeps a whole parish's history in memory is a dashboard that will
 * eventually take the process down.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatNameLastFirst } from "@/lib/members/name-format";
import { getSetting } from "@/lib/settings/store";
import { churchToday, daysBetween, shiftDays } from "@/lib/time/church-time";
import {
  dedupeSessions,
  type AttendanceMark,
  type MemberRow,
  type Session,
} from "@/lib/insights/metrics";

export const DASHBOARD_TTL_MS = 5 * 60 * 1000;

/** Keys currently cached, with the instant each was written. */
const cache = new Map<string, { at: number; value: unknown }>();

/** Bounded, so a long-lived server cannot accumulate every filter combination ever requested. */
const MAX_CACHE_ENTRIES = 100;

export function invalidateDashboards(): void {
  cache.clear();
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < DASHBOARD_TTL_MS) {
    return hit.value as T;
  }

  const value = await load();

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { at: now, value });
  return value;
}

/** Exposed for the health page and for tests. */
export function dashboardCacheSize(): number {
  return cache.size;
}

// ======================================================================================
// The shared read
// ======================================================================================

export type DashboardHistory = {
  asOf: string;
  members: MemberRow[];
  /** Live and archived, already deduplicated by session id. */
  sessions: Session[];
  /** Every attendance mark in the loaded window, live and archived. */
  marks: AttendanceMark[];
  /** Sessions the caller should see, for a role-specific view. */
  weekStart: string;
};

/**
 * Load the history a dashboard needs.
 *
 * `weeks` bounds the window on the session side; the member list is always complete because "who is on
 * the roll" is a constant, not a window.
 *
 * `months` bounds the attendance side, because the metrics that reach furthest back -- inactive members
 * at two months, at-risk at twelve weekends -- need marks older than the trend chart does. Reading only
 * twelve weeks would silently make every at-risk verdict wrong.
 */
export async function loadDashboardHistory(
  options: { weeks?: number; months?: number } = {},
): Promise<DashboardHistory> {
  const weeks = options.weeks ?? 12;
  const months = Math.max(options.months ?? 4, 4);

  const key = `history:${weeks}:${months}`;
  return cached(key, async () => {
    const sb = getSupabaseAdmin();
    const asOf = churchToday(await getSetting("report_timezone"));
    const sessionFrom = shiftDays(asOf, -(weeks * 7));
    const markFrom = shiftDays(asOf, -(months * 30));

    const [membersResult, liveSessions, archivedSessions, liveMarks, archivedMarks] = await Promise.all([
      sb.from("members").select("id, full_name, batch, is_active, date_of_birth"),
      sb
        .from("attendance_sessions")
        .select("id, session_date, mass_id, masses(name)")
        .gte("session_date", sessionFrom)
        .lte("session_date", asOf),
      sb
        .from("attendance_sessions_archive")
        .select("id, session_date, mass_id, mass_name, archived_at")
        .gte("session_date", sessionFrom)
        .lte("session_date", asOf),
      sb.from("attendance_records").select("session_id, member_id, recorded_at"),
      sb.from("attendance_records_archive").select("session_id, member_id, recorded_at, archived_at"),
    ]);

    const members: MemberRow[] = (membersResult.data ?? []).map((m) => ({
      id: String(m.id),
      fullName: formatNameLastFirst(String(m.full_name ?? "")),
      batch: (m.batch as string | null) ?? null,
      isActive: m.is_active !== false,
      dateOfBirth: (m.date_of_birth as string | null) ?? null,
    }));

    const dateBySession = new Map<string, string>();
    const massNameBySession = new Map<string, string | null>();
    const massIdBySession = new Map<string, string | null>();

    for (const s of liveSessions.data ?? []) {
      const id = String(s.id);
      dateBySession.set(id, String(s.session_date));
      massIdBySession.set(id, (s.mass_id as string | null) ?? null);
      massNameBySession.set(
        id,
        (s.masses as { name?: string } | null)?.name ?? null,
      );
    }
    for (const s of archivedSessions.data ?? []) {
      const id = String(s.id);
      // The archived row's denormalised name wins: the Mass may have been deleted since.
      if (!dateBySession.has(id)) dateBySession.set(id, String(s.session_date));
      if (!massIdBySession.has(id)) massIdBySession.set(id, (s.mass_id as string | null) ?? null);
      massNameBySession.set(id, (s.mass_name as string | null) ?? null);
    }

    const marks: AttendanceMark[] = [];
    const countBySession = new Map<string, number>();

    for (const r of liveMarks.data ?? []) {
      const sessionId = String(r.session_id);
      const date = dateBySession.get(sessionId);
      if (date === undefined || date < markFrom) continue;
      marks.push({
        memberId: String(r.member_id),
        sessionId,
        date,
      });
      countBySession.set(sessionId, (countBySession.get(sessionId) ?? 0) + 1);
    }

    for (const r of archivedMarks.data ?? []) {
      const sessionId = String(r.session_id);
      const date = dateBySession.get(sessionId);
      if (date === undefined || date < markFrom) continue;
      // Guard against a session that was archived twice: the same mark would otherwise be counted
      // twice and inflate both this member's streak and the session's attendance.
      if (marks.some((m) => m.sessionId === sessionId && m.memberId === String(r.member_id))) {
        continue;
      }
      marks.push({
        memberId: String(r.member_id),
        sessionId,
        date,
      });
      countBySession.set(sessionId, (countBySession.get(sessionId) ?? 0) + 1);
    }

    const sessions: Session[] = [...dateBySession.entries()].map(([id, date]) => ({
      id,
      date,
      massId: massIdBySession.get(id) ?? null,
      massName: massNameBySession.get(id) ?? null,
      attendanceCount: countBySession.get(id) ?? 0,
    }));

    return {
      asOf,
      members,
      sessions: dedupeSessions(sessions),
      marks,
      weekStart: shiftDays(asOf, -(weeks * 7)),
    };
  });
}

/** Sessions whose attendance the dashboard should not count because they have not happened yet. */
export function pastSessions(sessions: readonly Session[], asOf: string): Session[] {
  return sessions.filter((s) => s.date <= asOf);
}

/** Whole days since a date, for "waiting N days" lines. */
export function daysSince(date: string | null | undefined, asOf: string): number | null {
  if (!date) return null;
  const n = daysBetween(date.slice(0, 10), asOf);
  return n < 0 ? 0 : n;
}