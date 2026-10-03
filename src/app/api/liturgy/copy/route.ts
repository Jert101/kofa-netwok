import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { badRequest, notFound } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildCopy, copyOutcomeMessage, NOTHING_TO_COPY } from "@/lib/liturgy/rules";
import { copyBodySchema } from "@/features/liturgy/server/schemas";
import type { LiturgyTarget } from "@/features/liturgy/server/liturgy-rows";
import type { LiturgyRow } from "@/lib/liturgy/rules";

type Endpoint = { session_date: string; mass_id: string } | { session_id: string };

function asTarget(endpoint: Endpoint): LiturgyTarget {
  return "session_id" in endpoint
    ? { kind: "session", sessionId: endpoint.session_id }
    : { kind: "planned", sessionDate: endpoint.session_date, massId: endpoint.mass_id };
}

/**
 * LIT-2: read a source plan and hand back the rows it would copy.
 *
 * Deliberately a *preview*, not a write. Spec §4 says "Copying replaces the current rows after
 * confirmation", and the confirmation has to name the inactive members being dropped — which is
 * only knowable once the roster has been read. Writing here and confirming afterwards would mean
 * the officer cannot see what they are about to lose until it is already gone.
 */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!guard.ok) return guard.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }

  const parsed = copyBodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid copy request.");
  }

  const { from, to, include_members } = parsed.data;
  const sb = getSupabaseAdmin();

  // Resolve the destination first: copying into a session that does not exist would otherwise
  // look like a successful copy that vanished on the next save.
  const target = asTarget(to);
  const destination = await describeTarget(sb, target);
  if (!destination) return notFound("The plan you are copying into no longer exists.");

  const sourceRows = await readSource(sb, asTarget(from));
  if (!sourceRows) return notFound("That date's plan no longer exists.");

  if (sourceRows.length === 0) {
    return Response.json({ nothing_to_copy: true, message: NOTHING_TO_COPY, rows: [] });
  }

  const memberIds = [...new Set(sourceRows.map((r) => r.member_id).filter((id): id is string => !!id))];
  const memberMap = new Map<string, { id: string; full_name: string; is_active: boolean }>();
  if (memberIds.length > 0) {
    const { data: people } = await sb
      .from("members")
      .select("id, full_name, is_active")
      .in("id", memberIds);
    for (const m of people ?? []) {
      memberMap.set(String(m.id), {
        id: String(m.id),
        full_name: String(m.full_name ?? ""),
        is_active: m.is_active !== false,
      });
    }
  }

  const copy = buildCopy({ from: sourceRows, members: memberMap, includeMembers: include_members });
  const dropped = copyOutcomeMessage(copy.droppedInactive);

  // No audit row here. This endpoint only previews; nothing has been written yet, and an audit
  // log that recorded copies that were then cancelled would be worse than no entry. The write
  // that actually replaces the rows goes through the PUT handler and is audited there — and
  // says in its meta that it came from a copy.
  return Response.json({
    rows: copy.rows,
    dropped_inactive: copy.droppedInactive,
    // Two messages on purpose: one says what happened to the copy, the other says what was
    // left out. They are null when nothing was dropped, so the client can stay silent.
    message: dropped,
    dropped_message: dropped,
    into: destination,
  });
}

async function describeTarget(sb: ReturnType<typeof getSupabaseAdmin>, target: LiturgyTarget) {
  if (target.kind === "planned") {
    const { data: mass } = await sb
      .from("masses")
      .select("name")
      .eq("id", target.massId)
      .maybeSingle();
    if (!mass) return null;
    return {
      mode: "planned" as const,
      session_date: target.sessionDate,
      mass_id: target.massId,
      mass_name: String(mass.name ?? "Mass"),
    };
  }

  const { data: session } = await sb
    .from("attendance_sessions")
    .select("id, session_date, mass_id")
    .eq("id", target.sessionId)
    .maybeSingle();
  if (!session) return null;

  const { data: mass } = await sb
    .from("masses")
    .select("name")
    .eq("id", String(session.mass_id))
    .maybeSingle();

  return {
    mode: "session" as const,
    session_id: target.sessionId,
    session_date: String(session.session_date),
    mass_id: String(session.mass_id),
    mass_name: String(mass?.name ?? "Mass"),
  };
}

async function readSource(
  sb: ReturnType<typeof getSupabaseAdmin>,
  target: LiturgyTarget,
): Promise<LiturgyRow[] | null> {
  const columns = "position_label, member_id, free_text";

  const query =
    target.kind === "planned"
      ? sb
          .from("liturgy_planned")
          .select(columns)
          .eq("session_date", target.sessionDate)
          .eq("mass_id", target.massId)
      : sb.from("session_liturgy_servers").select(columns).eq("session_id", target.sessionId);

  const { data, error } = await query.order("sort_order", { ascending: true });
  if (error) return null;

  return (data ?? []).map((r) => ({
    position_label: String(r.position_label ?? ""),
    member_id: (r.member_id as string | null) ?? null,
    free_text: (r.free_text as string | null) ?? null,
  }));
}