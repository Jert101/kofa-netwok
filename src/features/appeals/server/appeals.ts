import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "@/lib/settings/store";
import { todayInTimeZone } from "@/lib/attendance/metrics";
import { checkAppealWindow, parseWindowDays, windowClosesOn } from "@/lib/appeals/window";
import { guardReportNotGenerated } from "@/lib/reports/check-report-lock";

/**
 * Shared appeals logic, so the four routes cannot each invent their own idea of the
 * window or of what "already resolved" means.
 */

export type AppealWindowInfo = {
  open: boolean;
  /** null when there is no limit, which is what the member's card shows as "always open". */
  closes_on: string | null;
  days: number;
};

/**
 * Whether an appeal for this session can still be submitted, and the date to print on
 * the member's card.
 *
 * Reports closed even when the window is open, because both conditions block a
 * submission and the card has to tell the member which one it is. A secretary looking
 * at "Appeals close on the 3rd" for a month whose report is already approved would
 * otherwise send the member off to try.
 */
export async function appealWindowFor(
  sb: SupabaseClient,
  sessionDate: string,
): Promise<AppealWindowInfo> {
  const timeZone = await getSetting("report_timezone");
  const today = todayInTimeZone(new Date(), timeZone);
  const windowDays = parseWindowDays(await getSetting("appeal_window_days"));

  const verdict = checkAppealWindow(sessionDate, today, windowDays);
  const guard = await guardReportNotGenerated(sb, sessionDate);

  return {
    open: verdict.open && !guard.blocked,
    closes_on: verdict.open ? verdict.closes_on : windowClosesOn(sessionDate, windowDays),
    days: windowDays,
  };
}

export type ApproveResult =
  | { ok: true; approved: number; merged: number; added: number; already: number }
  | { ok: false; reason: "report_locked" | "session_missing" | "error"; message: string };

/**
 * APL-7: approve a selection through the Postgres function, in one transaction.
 *
 * Every route approves through here rather than writing the tables itself. The function
 * checks the report lock again even though callers check it first, because between that
 * first check and the call a report can be generated — and an appeal approved into a
 * month that closed a minute ago is a change to a locked report.
 */
export async function approveAppealItems(
  sb: SupabaseClient,
  params: { sessionId: string; itemIds: string[]; reviewerRole: "admin" | "secretary" },
): Promise<ApproveResult> {
  if (params.itemIds.length === 0) {
    return { ok: true, approved: 0, merged: 0, added: 0, already: 0 };
  }

  const { data, error } = await sb.rpc("approve_appeal_items", {
    p_session_id: params.sessionId,
    p_item_ids: params.itemIds,
    p_reviewer_role: params.reviewerRole,
  });

  if (error) {
    // Postgres raises a plain EXCEPTION from the function, so the message is ours, not
    // a machine code. Matching on the text is unpleasant but is what a PL/pgSQL RAISE
    // gives us; the alternative is a custom SQLSTATE per failure, which is more code
    // than the two cases here justify.
    if (error.message.includes("month is locked")) {
      return { ok: false, reason: "report_locked", message: error.message };
    }
    if (error.message.includes("session not found")) {
      return { ok: false, reason: "session_missing", message: "That session no longer exists." };
    }
    return { ok: false, reason: "error", message: error.message };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { approved?: number; merged_duplicates?: number; attendance_added?: number; already_resolved?: number }
    | null;

  return {
    ok: true,
    approved: row?.approved ?? 0,
    merged: row?.merged_duplicates ?? 0,
    added: row?.attendance_added ?? 0,
    already: row?.already_resolved ?? 0,
  };
}

/** APL-3 / APL-5: close one item as rejected, with a reason the member can read. */
export async function rejectAppealItem(
  sb: SupabaseClient,
  params: { itemId: string; reason: string; reviewerRole: "admin" | "secretary" },
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "already_resolved"; message: string }> {
  // Conditional update rather than read-then-write. The status lives in the WHERE
  // clause, so two reviewers rejecting at once means exactly one UPDATE matches a row
  // and the other is told it was already done.
  const { data, error } = await sb
    .from("attendance_appeal_items")
    .update({
      status: "rejected",
      resolution: "rejected",
      reject_reason: params.reason,
      reviewed_by_role: params.reviewerRole,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", params.itemId)
    .eq("status", "pending")
    .select("id");

  if (error) return { ok: false, reason: "not_found", message: error.message };

  if (!data || data.length === 0) {
    const { data: existing } = await sb
      .from("attendance_appeal_items")
      .select("id, status")
      .eq("id", params.itemId)
      .maybeSingle();

    if (!existing) return { ok: false, reason: "not_found", message: "That appeal no longer exists." };
    return {
      ok: false,
      reason: "already_resolved",
      message: `This appeal was already ${existing.status}.`,
    };
  }

  return { ok: true };
}

/**
 * Items that can still be approved for a session, newest first, deduped by member.
 *
 * The dedupe is what the reviewer sees. Two different people can appeal for the same
 * member, and showing the name twice would invite approving the same record twice.
 */
export async function pendingItemsForSession(
  sb: SupabaseClient,
  sessionId: string,
  limit = 200,
): Promise<
  {
    id: string;
    member_id: string;
    member_name: string;
    created_at: string;
    submitted_at: string;
    /**
     * The member's own words. The reviewer panel renders this next to the name, and it is the
     * reason the appeal was filed, so leaving it off the pending payload meant the person deciding
     * could see *that* someone disagreed and not *why*.
     */
    note: string | null;
  }[]
> {
  const { data, error } = await sb
    .from("attendance_appeal_items")
    .select(
      // The member comes off the *item*, not the appeal header. An appeal header is per Mass and
      // carries only a note, so it has no relationship to `members` at all -- asking for
      // `attendance_appeals!inner(..., members!inner(full_name))` was answered with PGRST200, this
      // function threw, and the per-session appeals panel rendered its empty state for a Mass that
      // really did have an appeal waiting. Same failure as the archive embed in `loadRoster`: a
      // relationship that cannot exist, throwing where nothing catches it.
      "id, member_id, created_at, members(full_name), attendance_appeals!inner(session_id, submitted_at, note)",
    )
    .eq("status", "pending")
    .eq("attendance_appeals.session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const rows: {
    id: string;
    member_id: string;
    member_name: string;
    created_at: string;
    submitted_at: string;
    note: string | null;
  }[] = [];

  for (const row of data ?? []) {
    const parent = firstOrSelf(row.attendance_appeals) as {
      submitted_at?: string;
      note?: string | null;
    } | null;
    const member = firstOrSelf(row.members) as { full_name?: string } | null;
    const memberId = String(row.member_id);

    if (seen.has(memberId)) continue;
    seen.add(memberId);

    rows.push({
      id: String(row.id),
      member_id: memberId,
      member_name: member?.full_name ?? "Member",
      created_at: String(row.created_at),
      submitted_at: String(parent?.submitted_at ?? row.created_at),
      note: (parent?.note as string | null) ?? null,
    });
  }

  return rows;
}

/** PostgREST returns an embedded relation as an object or an array depending on the filter. */
function firstOrSelf(value: unknown): unknown {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Still-pending appeal items for a calendar month, with the number of Masses affected.
 *
 * Three flat queries rather than one nested join through
 * `attendance_appeals -> attendance_sessions`, because the nested form returns the session
 * as an object *or* a one-element array depending on the filter PostgREST inferred. Callers
 * that got that wrong silently counted zero, which is the one result a warning must never
 * produce. Same walk as the calendar's appeal indicator, so both agree.
 */
export async function pendingAppealsInMonth(
  sb: SupabaseClient,
  monthStart: string,
  monthEnd: string,
): Promise<{ pendingCount: number; sessionCount: number }> {
  const { data: items, error: iErr } = await sb
    .from("attendance_appeal_items")
    .select("appeal_id")
    .eq("status", "pending");
  if (iErr) throw new Error(iErr.message);

  const appealIds = [...new Set((items ?? []).map((r) => String(r.appeal_id)))];
  if (appealIds.length === 0) return { pendingCount: 0, sessionCount: 0 };

  const { data: appeals, error: aErr } = await sb
    .from("attendance_appeals")
    .select("id, session_id")
    .in("id", appealIds);
  if (aErr) throw new Error(aErr.message);

  const sessionIds = [...new Set((appeals ?? []).map((r) => String(r.session_id)))];
  if (sessionIds.length === 0) return { pendingCount: 0, sessionCount: 0 };

  const { data: sessions, error: sErr } = await sb
    .from("attendance_sessions")
    .select("id, session_date")
    .in("id", sessionIds)
    .gte("session_date", monthStart)
    .lte("session_date", monthEnd);
  if (sErr) throw new Error(sErr.message);

  const inMonthSessionIds = new Set((sessions ?? []).map((s) => String(s.id)));
  if (inMonthSessionIds.size === 0) return { pendingCount: 0, sessionCount: 0 };

  // An appeal belongs to one session, so items whose session is outside the month are out
  // of scope. Counted from the item -> appeal mapping rather than assumed from the totals.
  const appealToSession = new Map((appeals ?? []).map((a) => [String(a.id), String(a.session_id)]));
  let pendingCount = 0;
  for (const item of items ?? []) {
    const sessionId = appealToSession.get(String(item.appeal_id));
    if (sessionId && inMonthSessionIds.has(sessionId)) pendingCount++;
  }

  return { pendingCount, sessionCount: inMonthSessionIds.size };
}
