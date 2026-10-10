import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { canEncodeSession } from "@/lib/attendance/future-session";
import { guardSessionWrite, selectSessionsResilient, sessionLabel } from "@/lib/attendance/guard-session-write";
import { deleteLiturgyLinkedAnnouncement } from "@/lib/attendance/liturgy-announcement";
import { monthBounds, monthLabel } from "@/lib/reports/report-lock";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { loadRoster, type RosterEntry } from "@/features/attendance/server/load-roster";
import { readLiturgyRows } from "@/features/liturgy/server/liturgy-rows";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import { guardReportNotGenerated } from "@/lib/reports/check-report-lock";
import { appealWindowFor } from "@/features/appeals/server/appeals";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["member", "secretary", "admin", "officer"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();
  // Same 041 resilience as the day view: a database without `title` holds Masses only, so the
  // fallback changes nothing about what the secretary sees.
  const { data: session, error } = await selectSessionsResilient<Record<string, unknown>>(
    (columns) => sb.from("attendance_sessions").select(columns).eq("id", id).maybeSingle(),
    "id, session_date, mass_id, title, notes, masses(name)",
    "id, session_date, mass_id, notes, masses(name)",
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // `mass_id` null means a gathering: a meeting or a training day, with no Mass behind it. Every Mass-only
  // step below is skipped rather than run with a null, because each of them builds a Mass id into a query
  // and would otherwise match nothing and look like the ministry had assigned nobody.
  const isGathering = session.mass_id == null;

  const { data: records, error: rErr } = await sb
    .from("attendance_records")
    .select("member_id, members(full_name)")
    .eq("session_id", id)
    .order("created_at", { ascending: true });

  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }

  const rawMembers = (records ?? []).map((r) => ({
    member_id: r.member_id as string,
    full_name: (r.members as { full_name?: string } | null)?.full_name ?? "",
  }));
  const seen = new Set<string>();
  const members = rawMembers.filter((m) => {
    if (!m.member_id || seen.has(m.member_id)) return false;
    seen.add(m.member_id);
    return true;
  });

  // One read that knows how to build both the rows and their version. This route used to run its
  // own query for the rows and report no version at all, which meant the planner handed the editor
  // rows along with `expected_version: null` and the concurrent-save notice could never fire on the
  // session screen. Now the same two values the editor gets are the ones `/api/liturgy/*` would
  // have answered, computed once instead of re-implemented.
  //
  // A gathering has no Mass, so it has no liturgy: no positions were assigned, none can be, and a
  // secretary shown an empty server list with an editor in front of it would reasonably conclude the
  // officer had not done their job. The screen hides the whole panel for a gathering on the strength of
  // `has_liturgy: false`.
  const liturgyRead = isGathering ? null : await readLiturgyRows(sb, { kind: "session", sessionId: id });

  let liturgy_servers = liturgyRead?.ok
    ? liturgyRead.rows.map((row) => ({
        id: `session-${row.sort_order}`,
        position_label: row.position_label,
        member_id: row.member_id,
        member_name: (row.memberName ?? "").trim() || null,
        free_text: row.free_text,
        sort_order: row.sort_order,
      }))
    : [];

  // No rows of their own yet: the session sits on the planned lineup as a seed. The version that
  // matters is the session's own (empty here), because that is what the editor's save will replace.
  const liturgy_version = liturgyRead?.ok ? liturgyRead.version : null;

  if (liturgy_servers.length === 0 && !isGathering) {
    const { data: plannedRows, error: plErr } = await sb
      .from("liturgy_planned")
      .select("position_label, member_id, free_text, sort_order, members(full_name)")
      .eq("session_date", session.session_date)
      .eq("mass_id", session.mass_id as string)
      .order("sort_order", { ascending: true });
    if (!plErr && plannedRows?.length) {
      liturgy_servers = plannedRows.map((row, i) => ({
        id: `planned-${i}`,
        position_label: row.position_label as string,
        member_id: (row.member_id as string | null) ?? null,
        member_name: ((row.members as { full_name?: string } | null)?.full_name ?? "").trim() || null,
        free_text: (row.free_text as string | null) ?? null,
        sort_order: (row.sort_order as number) ?? i,
      }));
    }
  }

  // ATT-7 and ATT-8, sent with the session so the screen can show its banner and
  // disable its toggles on first paint rather than after a failed tap. The server
  // guard remains the source of truth; this is only what the UI mirrors.
  const timeZone = await getSetting("report_timezone");

  // loadRoster throws when one of its own queries fails, and nothing in this handler caught it, so
  // the failure reached the browser as a 500 with an empty body -- indistinguishable from a broken
  // link and impossible to diagnose from the page. Caught here so the reason is logged and the
  // secretary gets a real message. Deliberately not degraded to an empty roster: an empty roster
  // reads as "this Mass has nobody on it", and encoding into it would write wrong attendance.
  let roster: RosterEntry[];
  try {
    ({ roster } = await loadRoster(sb, id, timeZone));
  } catch (cause) {
    console.error("[attendance/session] roster load failed:", cause instanceof Error ? cause.message : cause);
    return NextResponse.json({ error: "Could not load the roster for this session." }, { status: 500 });
  }

  const guard = await guardReportNotGenerated(sb, String(session.session_date));
  const future = canEncodeSession(session.session_date as string, new Date(), timeZone);

  const { monthStart, monthEnd } = monthBounds(session.session_date as string);

  const payload: Record<string, unknown> = {
    session: {
      id: session.id,
      session_date: session.session_date,
      // Null for a gathering. It was cast to `string` and sent as one, which is how a meeting would
      // have arrived at the client as a Mass id of "null".
      mass_id: session.mass_id as string | null,
      title: (session.title as string | null) ?? null,
      // One label, built once here rather than by each of the day view, the appeal queue and the
      // notification -- three places that each got it wrong in a different way.
      mass_name: sessionLabel({
        mass_id: session.mass_id as string | null,
        title: session.title as string | null,
        massName: (session.masses as { name?: string } | null)?.name,
      }),
      // Whether the screen should offer a liturgy editor at all.
      has_liturgy: !isGathering,
      notes: session.notes,
    },
    members,
    liturgy_servers,
    liturgy_version,
    roster,
    locked: guard.blocked,
    locked_reason: guard.reason,
    locked_message: guard.message,
    is_future: !future.allowed,
    future_message: future.allowed ? null : future.message,
    month_label: monthLabel(monthStart),
    month_start: monthStart,
    month_end: monthEnd,
  };

  if (g.session.role === "member") {
    const cannotAppeal = new Set(members.map((m) => m.member_id));
    const { data: pendingRows, error: pErr } = await sb
      .from("attendance_appeal_items")
      .select("member_id, attendance_appeals!inner(session_id)")
      .eq("attendance_appeals.session_id", id)
      .eq("status", "pending");
    if (!pErr && pendingRows?.length) {
      for (const row of pendingRows) {
        cannotAppeal.add(row.member_id as string);
      }
    }
    payload.member_ids_cannot_appeal = [...cannotAppeal];

    // APL-1/APL-6: the card prints its own deadline, so the member is not left
    // submitting only to be told it closed.
    payload.appeal_window = await appealWindowFor(sb, String(session.session_date));

    // APL-4: the member's own appeals and how each was decided. Only available when a
    // declared identity exists; without one, every row would belong to anyone.
    const actorId = g.session.actor?.id;
    if (actorId) {
      const { data: mine } = await sb
        .from("attendance_appeal_items")
        .select(
          "id, status, resolution, reject_reason, reviewed_at, created_at, attendance_appeals!inner(submitted_at, note)",
        )
        .eq("member_id", actorId)
        .eq("attendance_appeals.session_id", id)
        .order("created_at", { ascending: false })
        .limit(50);

      payload.my_appeals = (mine ?? []).map((row) => {
        const parent = (
          Array.isArray(row.attendance_appeals) ? row.attendance_appeals[0] : row.attendance_appeals
        ) as { submitted_at?: string; note?: string | null } | null;
        return {
          id: String(row.id),
          status: String(row.status),
          resolution: (row.resolution as string | null) ?? null,
          reject_reason: (row.reject_reason as string | null) ?? null,
          reviewed_at: (row.reviewed_at as string | null) ?? null,
          submitted_at: parent?.submitted_at ?? String(row.created_at),
          note: parent?.note ?? null,
        };
      });
    }
  }

  return NextResponse.json(payload);
}

/**
 * Two different jobs on one route, because both are edits to the session and both
 * belong behind the same guards:
 *
 * `notes` — a free-text note, saved on blur by the roster screen.
 * `member_ids` — replace the whole roster. Kept for admin repair and imports, and is
 * the reason the shared screen does not use it for ordinary taps.
 *
 * Notes are allowed on a locked month, unlike roster changes. A report being approved
 * does not make the note describing that Mass wrong, and the secretary typing a note
 * should not be turned away. Attendance is what the lock protects.
 */
const patchSchema = z.object({
  member_ids: z.array(z.string().uuid()).optional(),
  notes: z.string().max(2_000).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const replacingRoster = parsed.data.member_ids !== undefined;
  const sb = getSupabaseAdmin();

  if (!replacingRoster) {
    const blocked = await guardSessionWrite({ sb, sessionId: id, notesOnly: true });
    if (blocked) return blocked;

    const { error } = await sb
      .from("attendance_sessions")
      .update({ notes: parsed.data.notes ?? null })
      .eq("id", id);
    if (error) {
      console.error("[attendance/session] notes update failed:", error.message);
      return NextResponse.json({ error: "Could not save that note." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Admin repair, so the lock and future-date guards are both enforced. The spec
  // keeps this endpoint for replacing a whole roster by hand, which is still the way
  // to fix a session that was encoded against a stale member list — but it must not
  // become the way around a locked month.
  const blocked = await guardSessionWrite({ sb, sessionId: id });
  if (blocked) return blocked;

  // One call, one transaction (`kofa_replace_attendance_roster`, migration 035). This used to be
  // three round trips from here, and the delete's error was never read: a failed delete left the
  // old roster, the insert added the new members on top of it, and this route answered 200 — so a
  // member the admin had just removed stayed counted as present in the report. In the other
  // direction, an insert that failed after a successful delete left the session with no attendance
  // at all. Both are now impossible: the function either replaces the roster or leaves it alone.
  const { data: rosterCount, error: replaceErr } = await sb.rpc("kofa_replace_attendance_roster", {
    p_session_id: id,
    p_member_ids: [...new Set(parsed.data.member_ids ?? [])],
    p_notes: parsed.data.notes ?? null,
  });

  if (replaceErr) {
    console.error("[attendance/session] roster replace failed:", replaceErr.message);
    // The old roster is untouched, so this is safe to retry -- which is the only thing that
    // makes a failed roster replacement recoverable.
    return NextResponse.json(
      { error: "Could not replace the roster. Nothing was changed." },
      { status: 500 },
    );
  }

  void notifyAttendanceSessionUpdated(id);

  return NextResponse.json({ ok: true, roster_size: rosterCount ?? 0 });
}

/**
 * ATT-9: delete a session, but only an empty one.
 *
 * Restricted to admin. A secretary creates a session by mistake fairly often, but
 * they also encode attendance all day, and the failure mode of letting them delete
 * is worse than the failure mode of leaving a stray empty Mass on the calendar.
 *
 * "Empty" means no attendance records, no appeals and no liturgy rows. The old
 * version deleted whatever it was pointed at with no check at all, so a stray tap
 * could destroy an encoded Mass.
 *
 * Safe to recreate afterwards: the (session_date, mass_id) unique key from migration
 * 027 means a deleted session leaves nothing blocking a new one.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();

  try {
    const { data: sess, error: sErr } = await sb
      .from("attendance_sessions")
      .select("session_date, mass_id")
      .eq("id", id)
      .maybeSingle();
    if (sErr) {
      return NextResponse.json({ error: sErr.message }, { status: 500 });
    }
    if (!sess) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const guard = await guardReportNotGenerated(sb, sess.session_date as string);
    if (guard.blocked) return NextResponse.json({ error: guard.message }, { status: 409 });

    // Counted rather than inferred from the roster payload, because the client may
    // have been holding stale data when it asked.
    const [records, appeals, liturgy] = await Promise.all([
      sb.from("attendance_records").select("id", { count: "exact", head: true }).eq("session_id", id),
      sb.from("attendance_appeals").select("id", { count: "exact", head: true }).eq("session_id", id),
      sb.from("session_liturgy_servers").select("id", { count: "exact", head: true }).eq("session_id", id),
    ]);

    const attendanceCount = records.count ?? 0;
    const appealCount = appeals.count ?? 0;
    const liturgyCount = liturgy.count ?? 0;

    if (attendanceCount || appealCount || liturgyCount) {
      return NextResponse.json(
        {
          error:
            attendanceCount || appealCount
              ? "This session has attendance recorded, so it cannot be deleted."
              : "This session has liturgy servers, so it cannot be deleted.",
          counts: {
            attendance_records: attendanceCount,
            appeals: appealCount,
            liturgy_servers: liturgyCount,
          },
        },
        { status: 409 },
      );
    }

    // Only a Mass session can have a liturgy announcement, because the announcement's dedupe key is
    // built from (date, mass). For a gathering `mass_id` is null, and casting that to a string here would
    // have deleted whatever was keyed "null" on that date -- so the call is skipped, not coerced.
    if (sess.mass_id) {
      await deleteLiturgyLinkedAnnouncement(sb, String(sess.session_date), sess.mass_id as string);
    }

    const { error } = await sb.from("attendance_sessions").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[attendance/session] delete failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
