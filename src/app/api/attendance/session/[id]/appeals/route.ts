import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import {
  appealWindowClosed,
  badRequest,
  internalError,
  jsonOk,
  notFound,
  rateLimited,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { checkSubmitAllowed, recordAttempt } from "@/lib/auth/throttle";
import { getClientIp } from "@/lib/auth/ip-hash";
import { logAudit } from "@/lib/audit/log-audit";
import { normalizeAppealNote } from "@/lib/appeals/reject-reasons";
import { notify } from "@/lib/notify/notify";
import { decideAppealEligibility, explainBlocked } from "@/lib/appeals/eligibility";
import { appealWindowFor, pendingItemsForSession } from "@/features/appeals/server/appeals";

type Ctx = { params: Promise<{ id: string }> };

const postSchema = z.object({
  member_ids: z.array(z.string().uuid()).min(1).max(40),
  /** APL-1: optional, e.g. "Served as thurifer". */
  note: z.string().max(400).nullable().optional(),
});

/**
 * Reviewer view of one session's pending items.
 *
 * Optional `?status=` so the same endpoint can show the resolved history for a past
 * session. That is the whole point of APL-3: a secretary answering "did we ever look at
 * this?" needs to see what was decided, not only what is still waiting.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const { id: sessionId } = await ctx.params;
  const sb = getSupabaseAdmin();

  const requested = new URL(req.url).searchParams.get("status") ?? "pending";
  if (requested !== "pending" && requested !== "approved" && requested !== "rejected" && requested !== "expired") {
    return validationFailed("Unknown status.", { status: "Use pending, approved, rejected or expired." });
  }

  try {
    if (requested === "pending") {
      const items = await pendingItemsForSession(sb, sessionId);
      return jsonOk({ appeals: items });
    }

    const { data, error } = await sb
      .from("attendance_appeal_items")
      .select(
        "id, member_id, status, resolution, reject_reason, reviewed_at, reviewed_by_role, created_at, members(full_name), attendance_appeals!inner(submitted_at, note)",
      )
      .eq("attendance_appeals.session_id", sessionId)
      .eq("status", requested)
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) return internalError();

    const appeals = (data ?? []).map((row) => {
      const parent = (Array.isArray(row.attendance_appeals) ? row.attendance_appeals[0] : row.attendance_appeals) as
        | { submitted_at?: string; note?: string | null }
        | null;
      const member = (Array.isArray(row.members) ? row.members[0] : row.members) as { full_name?: string } | null;
      return {
        id: String(row.id),
        member_id: String(row.member_id),
        member_name: member?.full_name?.trim() ?? "Member",
        status: String(row.status),
        resolution: (row.resolution as string | null) ?? null,
        reject_reason: (row.reject_reason as string | null) ?? null,
        reviewed_at: (row.reviewed_at as string | null) ?? null,
        reviewed_by_role: (row.reviewed_by_role as string | null) ?? null,
        created_at: String(row.created_at),
        submitted_at: parent?.submitted_at ?? String(row.created_at),
        note: parent?.note ?? null,
      };
    });

    return jsonOk({ appeals });
  } catch (e) {
    console.error("[appeals GET] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}

/**
 * APL-1 + APL-6: a member appeals.
 *
 * The order of the checks matters. Throttle first, because it is the cheapest way to
 * stop abuse and the least useful to anyone waiting. Window and lock next, before the
 * roster work, so a member who is too late gets that answer rather than "already on the
 * attendance list" — which is true and irrelevant, and sends them looking for a
 * different problem.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["member"]);
  if (!g.ok) return g.response;

  // AUTH-2: appeals are member-facing and unbounded in scope, so keep spam bounded per
  // client.
  const ip = getClientIp(req.headers);
  const submitGate = await checkSubmitAllowed("appeal", ip);
  if (submitGate.blocked) {
    await recordAttempt("appeal", ip, false);
    return rateLimited(
      `Too many appeal attempts. Try again in ${Math.ceil(submitGate.retryAfterSeconds / 60)} minute(s).`,
    );
  }

  const { id: sessionId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return validationFailed("Choose at least one name.", zodFields(parsed.error));

  const sb = getSupabaseAdmin();

  const { data: session, error: sessionError } = await sb
    .from("attendance_sessions")
    .select("id, session_date")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) return internalError();
  if (!session) return notFound("Session not found.");

  const sessionDate = String(session.session_date);

  const window = await appealWindowFor(sb, sessionDate);
  if (!window.open) {
    await recordAttempt("appeal", ip, false);
    return appealWindowClosed(
      window.closes_on ?? "",
      window.closes_on
        ? `Appeals for this Mass closed on ${window.closes_on}.`
        : "Appeals for this Mass are closed.",
    );
  }

  const uniqueMemberIds = [...new Set(parsed.data.member_ids)];

  // Read everything the eligibility rule needs, then ask the rule. The rule lives in
  // src/lib/appeals/eligibility so it can be tested without a database, and so the route
  // does not grow a second, subtly different copy of "cannot appeal".
  const { data: memberRows, error: memberError } = await sb
    .from("members")
    .select("id, is_active")
    .in("id", uniqueMemberIds);
  if (memberError) return internalError();

  // A member id that does not exist is a 404, not a refusal: the caller asked about
  // something the system no longer has, which is a different problem from being told no.
  const existingMemberIds = new Set((memberRows ?? []).map((m) => String(m.id)));
  const unknownMemberIds = uniqueMemberIds.filter((id) => !existingMemberIds.has(id));
  if (unknownMemberIds.length > 0) {
    await recordAttempt("appeal", ip, false);
    return notFound("One of the selected members no longer exists.");
  }

  const [rosterResult, pendingResult] = await Promise.all([
    sb
      .from("attendance_records")
      .select("member_id")
      .eq("session_id", sessionId)
      .in("member_id", uniqueMemberIds),
    sb
      .from("attendance_appeal_items")
      .select("member_id, attendance_appeals!inner(session_id)")
      .eq("attendance_appeals.session_id", sessionId)
      .eq("status", "pending")
      .in("member_id", uniqueMemberIds),
  ]);

  if (rosterResult.error) return internalError();
  if (pendingResult.error) return internalError();

  const eligibility = decideAppealEligibility({
    requested: uniqueMemberIds,
    onRoster: (rosterResult.data ?? []).map((r) => String(r.member_id)),
    pending: (pendingResult.data ?? []).map((r) => String(r.member_id)),
    // APL-6: an appeal for someone who has left is refused. There is nobody to read the
    // outcome and no record to correct.
    inactive: (memberRows ?? []).filter((m) => m.is_active === false).map((m) => String(m.id)),
  });

  if (eligibility.blocked.length > 0) {
    await recordAttempt("appeal", ip, false);
    return badRequest(explainBlocked(eligibility.blocked));
  }

  const toAppeal = eligibility.eligible;

  const note = normalizeAppealNote(parsed.data.note);

  // APL-6: auto-approve respects the window and the lock, both already checked above.
  // source is recorded so the report can tell an approved appeal from a typed-in name.
  if ((await getSetting("attendance_auto_approve_appeals")) === "true") {
    const { error: upsertError } = await sb.from("attendance_records").upsert(
      toAppeal.map((memberId) => ({
        session_id: sessionId,
        member_id: memberId,
        source: "appeal_auto",
        recorded_by_role: "member",
      })),
      { onConflict: "session_id,member_id", ignoreDuplicates: true },
    );
    if (upsertError) {
      await recordAttempt("appeal", ip, false);
      return internalError();
    }

    void notifyAttendanceSessionUpdated(sessionId);
    await logAudit({
      action: "appeal_auto_approved",
      actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
      entityType: "attendance_session",
      entityId: sessionId,
      meta: { approved: toAppeal.length, note },
      ip: getClientIp(req.headers),
    });
    await recordAttempt("appeal", ip, true);

    return jsonOk({ auto_approved: true, approved_count: toAppeal.length });
  }

  const { data: appeal, error: appealError } = await sb
    .from("attendance_appeals")
    .insert({ session_id: sessionId, submitted_by_role: g.session.role, note })
    .select("id")
    .single();
  if (appealError || !appeal) {
    await recordAttempt("appeal", ip, false);
    return internalError("Could not submit appeal.");
  }

  const { error: itemError } = await sb.from("attendance_appeal_items").insert(
    toAppeal.map((memberId) => ({ appeal_id: appeal.id as string, member_id: memberId })),
  );
  if (itemError) {
    await recordAttempt("appeal", ip, false);
    return internalError();
  }

  await logAudit({
    action: "appeal_submitted",
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    entityType: "attendance_appeal",
    entityId: String(appeal.id),
    meta: { sessionId, count: toAppeal.length, note },
    ip: getClientIp(req.headers),
  });
  await recordAttempt("appeal", ip, true);

  // COM-5: the secretary gets this through the catalog. The event names the session rather than
  // every member, because the appeal is one request even when it lists several names.
  await notify(
    "appeal_submitted",
    { member_name: g.session.actor?.name ?? "A member", session_label: sessionDate },
    { fromRole: g.session.role },
  );

  return jsonOk({ appeal_id: appeal.id, submitted_count: toAppeal.length });
}
