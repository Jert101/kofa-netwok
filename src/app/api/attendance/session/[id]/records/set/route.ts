import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, validationFailed } from "@/lib/api/response";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { guardSessionWrite } from "@/lib/attendance/guard-session-write";
import {
  applyPresenceChanges,
  markAllPresent,
  clearAll,
  type PresenceChange,
} from "@/features/attendance/server/roster-writes";

type Ctx = { params: Promise<{ id: string }> };

const setSchema = z.object({
  changes: z
    .array(
      z.object({
        member_id: z.string().uuid(),
        present: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
});

const bulkSchema = z.object({
  op: z.enum(["mark_all", "clear_all"]),
});

/**
 * ATT-5: set presence for named members, idempotently.
 *
 * This is the endpoint the roster taps use, and the reason two secretaries can
 * encode at the same time. The old roster save replaced every row for the session,
 * so two phones marking different people would clobber each other: whoever saved
 * last won the whole roster. Here each change names its own member, so two requests
 * touching different members are independent, and two touching the same member
 * resolve last-write-wins rather than losing both.
 *
 * Setting `present: false` on someone who is already absent is a no-op, which is
 * what makes a retry after a dropped connection safe to send twice.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return validationFailed("Invalid body.", {});
  }

  const isBulk = "op" in (json as Record<string, unknown>);

  const sb = getSupabaseAdmin();
  const blocked = await guardSessionWrite({ sb, sessionId: id });
  if (blocked) return blocked;

  try {
    if (isBulk) {
      const parsed = bulkSchema.safeParse(json);
      if (!parsed.success) return validationFailed("Invalid body.", {});

      const result =
        parsed.data.op === "mark_all"
          ? await markAllPresent(sb, id)
          : await clearAll(sb, id);

      void notifyAttendanceSessionUpdated(id);
      return jsonOk({ ok: true, ...result });
    }

    const parsed = setSchema.safeParse(json);
    if (!parsed.success) return validationFailed("Invalid body.", {});

    const changes: PresenceChange[] = parsed.data.changes.map((c) => ({
      memberId: c.member_id,
      present: c.present,
    }));

    const result = await applyPresenceChanges(sb, id, changes);

    void notifyAttendanceSessionUpdated(id);
    return jsonOk({ ok: true, ...result });
  } catch (e) {
    console.error("[attendance/session/records/set] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}
