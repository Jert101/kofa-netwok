import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import {
  badRequest,
  internalError,
  notFound,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/log-audit";
import { saveBodySchema } from "./schemas";
import {
  computeWarnings,
  countUnassigned,
  readLiturgyRows,
  unassignedSummary,
  writeLiturgyRows,
  type LiturgyTarget,
} from "./liturgy-rows";
import type { LiturgySlotInput } from "@/lib/liturgy/rules";
import type { Role } from "@/lib/auth/roles";

/**
 * The one GET/PUT pair behind both key styles.
 *
 * Spec §5 gives `/api/liturgy/planned` and `/api/liturgy/session/[id]` the same contract, and the
 * two route files are three lines each because of this. It also means the "last save wins with
 * an 'Updated by another device' notice" rule is implemented once rather than once per mode.
 */

/**
 * Who may read and write each mode, and the two lists differ on purpose.
 *
 * `planned` is the officer's plan for a Mass that has not happened yet. `session` is the record of who
 * actually served, kept on the session the secretary is running -- the secretary is the one standing
 * there, and `SessionScreen` has always offered them this editor. With one allowlist for both, the
 * secretary's editor could not even load its rows, let alone save: every tap ended in a 401 from a
 * control the app itself had put on their screen.
 *
 * So the check is per mode rather than per handler. The secretary gains the session record, which is
 * theirs to write, and still cannot touch the officer's plan.
 */
const LITURGY_ROLES: Record<LiturgyTarget["kind"], Role[]> = {
  planned: ["officer", "admin"],
  session: ["officer", "admin", "secretary"],
};

type ResolvedTarget =
  | { ok: true; target: LiturgyTarget; massId: string; massName: string; date: string }
  | { ok: false; response: ReturnType<typeof badRequest> | ReturnType<typeof notFound> };

/** Resolve the Mass behind a target, so both modes can answer "which Mass is this". */
async function resolveTarget(target: LiturgyTarget): Promise<ResolvedTarget> {
  const sb = getSupabaseAdmin();

  let sessionDate: string;
  let massId: string;

  if (target.kind === "planned") {
    sessionDate = target.sessionDate;
    massId = target.massId;
  } else {
    const { data: session } = await sb
      .from("attendance_sessions")
      .select("session_date, mass_id")
      .eq("id", target.sessionId)
      .maybeSingle();
    if (!session) return { ok: false, response: notFound("That session no longer exists.") };
    // A gathering has no Mass, so there is nothing to plan servers for. Refused here rather than run
    // with a null id, which the lookup below would report as "Mass not found" -- true in a sense that
    // helps nobody, since the session exists and simply is not a Mass.
    if (session.mass_id == null) {
      return { ok: false, response: badRequest("A meeting has no servers to plan.") };
    }
    sessionDate = String(session.session_date);
    massId = String(session.mass_id);
  }

  const { data: mass } = await sb.from("masses").select("id, name").eq("id", massId).maybeSingle();
  if (!mass) return { ok: false, response: notFound("Mass not found.") };

  return { ok: true, target, massId, massName: String(mass.name ?? "Mass"), date: sessionDate };
}

export async function handleLiturgyGet(req: NextRequest, target: LiturgyTarget) {
  const guard = await requireRole(req.headers.get("cookie"), LITURGY_ROLES[target.kind]);
  if (!guard.ok) return guard.response;

  const resolved = await resolveTarget(target);
  if (!resolved.ok) return resolved.response;

  const sb = getSupabaseAdmin();
  const read = await readLiturgyRows(sb, target);
  if (!read.ok) return internalError(read.message);

  const counts = countUnassigned(read.rows);
  const { warnings, summary } = await computeWarnings(sb, target, read.rows);

  return Response.json({
    mode: target.kind,
    session_date: resolved.date,
    mass_id: resolved.massId,
    mass_name: resolved.massName,
    session_id: target.kind === "session" ? target.sessionId : null,
    rows: read.rows,
    version: read.version,
    summary: { ...counts, text: unassignedSummary(counts) },
    warnings,
    warning_summary: summary,
  });
}

export async function handleLiturgyPut(req: NextRequest, target: LiturgyTarget) {
  const guard = await requireRole(req.headers.get("cookie"), LITURGY_ROLES[target.kind]);
  if (!guard.ok) return guard.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }

  const raw = json as { slots?: unknown; expected_version?: unknown; copied_from?: unknown };
  if (!raw || !Array.isArray(raw.slots)) return badRequest("Provide a list of slots.");

  // Schema-validated rather than cast. The schemas already exist and were the one place where
  // `member_id` being a non-uuid string or `position_label` being absent was already described;
  // validating here is what makes them true instead of aspirational.
  const parsed = saveBodySchema.safeParse({
    slots: raw.slots,
    expected_version: typeof raw.expected_version === "string" ? raw.expected_version : undefined,
  });
  if (!parsed.success) {
    return validationFailed("Check the rows and try again.", zodFields(parsed.error));
  }
  const slots = parsed.data.slots as LiturgySlotInput[];

  // Optional provenance for the audit row. `/api/liturgy/copy` previews a copy and the editor
  // then saves the result here, so without this the trail would record the save as an ordinary
  // edit and the difference between "retyped the lineup" and "copied last week" would be lost.
  const copiedFrom =
    raw.copied_from && typeof raw.copied_from === "object"
      ? (raw.copied_from as Record<string, unknown>)
      : null;

  const resolved = await resolveTarget(target);
  if (!resolved.ok) return resolved.response;

  const sb = getSupabaseAdmin();
  const written = await writeLiturgyRows(sb, target, slots, {
    expectedVersion:
      typeof raw.expected_version === "string" && raw.expected_version.length <= 60
        ? raw.expected_version
        : null,
  });

  if (!written.ok) {
    // An inactive member blocks the save; nothing else does. Spec §3 says warnings "never block
    // saving", but this is not a warning about a choice the officer made — it is a value the
    // server refuses to write.
    if (written.code === "INVALID_MEMBER") {
      return badRequest(
        written.message,
        written.inactiveNames ? { inactive: written.inactiveNames.join(", ") } : undefined,
      );
    }
    return badRequest(written.message);
  }

  const { warnings, summary } = await computeWarnings(sb, target, written.rows);
  const counts = countUnassigned(written.rows);

  await logAudit({
    action:
      written.rows.length === 0
        ? "liturgy_cleared"
        : copiedFrom
          ? "liturgy_copied"
          : "liturgy_saved",
    actor: {
      role: guard.session.role,
      memberId: guard.session.actor?.id ?? null,
      name: guard.session.actor?.name ?? null,
    },
    entityType: target.kind === "planned" ? "liturgy_planned" : "session_liturgy_servers",
    entityId:
      target.kind === "session" ? target.sessionId : `${target.sessionDate}:${target.massId}`,
    meta: {
      mass_name: resolved.massName,
      session_date: resolved.date,
      rows: written.rows.length,
      unassigned: counts.unassigned,
      new_labels: written.newLabels,
      updated_by_other_device: written.updatedByOtherDevice,
      copied_from: copiedFrom,
    },
  });

  return Response.json({
    mode: target.kind,
    session_date: resolved.date,
    mass_id: resolved.massId,
    mass_name: resolved.massName,
    session_id: target.kind === "session" ? target.sessionId : null,
    rows: written.rows,
    version: written.version,
    new_labels: written.newLabels,
    updated_by_other_device: written.updatedByOtherDevice,
    summary: { ...counts, text: unassignedSummary(counts) },
    warnings,
    warning_summary: summary,
  });
}