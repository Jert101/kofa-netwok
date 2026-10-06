import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import { logAudit } from "@/lib/audit/log-audit";
import { drawSlots, type BulkMember } from "@/lib/liturgy/bulk-assign";
import { asGenderRule, type TemplatePosition } from "@/lib/liturgy/rules";
import {
  MAX_DRAFTS,
  announcementBody,
  announcementTitle,
  endOfDayInstant,
  rosterLines,
} from "@/lib/liturgy/assign-batch";
import {
  pushLiturgyAssignmentsNotification,
  upsertLiturgyRosterAnnouncement,
} from "@/lib/attendance/liturgy-announcement";
import { churchTodayLabel } from "@/lib/time/church-time-labels";

/**
 * Save a queue of assignments the officer built on /officer/assign.
 *
 * One request per queue rather than one per entry, because a queue of six Sundays that fails on the
 * sixth is a worse experience than six requests where the fifth reports why it did not go -- and
 * because the draw has to be threaded across the whole batch. Two Masses on the same Sunday in one
 * queue must not be given the same person, and that only holds if the used-set is shared here
 * rather than rebuilt per request.
 *
 * The drawing happens on the server, not in the browser, even though `drawSlots` is pure and the
 * range tool already calls it client-side. The reason is the announcement: the body of the post and
 * the body of the notification are both built from the roster that was actually written, so the
 * parish cannot be told about a lineup that a second request changed underneath them.
 *
 * One failure does not abort the rest. Each entry reports what happened to it, because "six Sundays
 * added and the third silently did nothing" is how an officer ends up not trusting the page.
 */

const draftSchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  mass_id: z.string().uuid(),
  template_id: z.string().uuid(),
  announce: z.boolean().default(false),
  /** Checked against `announce` below rather than in the schema, so the message can name both. */
  announce_delete_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  /**
   * Replace a roster that is already stored for this date and Mass.
   *
   * Off by default, matching the range tool: an officer who adds a Sunday by accident should not
   * silently overwrite the servers somebody else wrote for that Mass.
   */
  replace: z.boolean().default(false),
});

const bodySchema = z.object({ assignments: z.array(draftSchema).min(1).max(MAX_DRAFTS) });

type Draft = z.infer<typeof draftSchema>;

type EntryResult = {
  session_date: string;
  mass_id: string;
  mass_name: string;
  ok: boolean;
  saved: number;
  unfilled: number;
  announced: boolean;
  announcement_id: string | null;
  /** Why this entry did not go, in the officer's words rather than a constraint name. */
  message: string;
};

export async function POST(req: NextRequest) {
  // Reached rather than declared: an admin runs the sacristy as often as the officer does, and the
  // super admin reaches everything. Nothing here reverses money or approves a report.
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That assignment could not be read." },
      { status: 400 },
    );
  }

  const drafts = parsed.data.assignments;

  // Two entries for the same date and Mass would be two writes to the same rows and two
  // announcements for one Sunday. The modal replaces in place, so reaching here means a crafted
  // request rather than an accident.
  const seen = new Set<string>();
  for (const d of drafts) {
    const key = `${d.session_date}|${d.mass_id}`;
    if (seen.has(key)) {
      return NextResponse.json(
        { error: "That date and Mass is in the list twice. Add it once." },
        { status: 400 },
      );
    }
    seen.add(key);
  }

  // Announcing needs a day to disappear on, and it cannot be the day before the Mass it announces.
  // Checked before anything is written so a bad entry does not leave a roster behind with no notice.
  for (const d of drafts) {
    if (!d.announce) continue;
    if (!d.announce_delete_at) {
      return NextResponse.json(
        { error: `Choose the day the announcement will be removed for ${d.session_date}, or untick announcing.` },
        { status: 400 },
      );
    }
    if (d.announce_delete_at < d.session_date) {
      return NextResponse.json(
        {
          error: `The announcement for ${d.session_date} would be removed before the Mass it is announcing.`,
        },
        { status: 400 },
      );
    }
  }

  const sb = getSupabaseAdmin();

  // Everything the batch needs, read once. Six Sundays is six round trips otherwise, and the roll
  // does not change while the request is in flight.
  const massIds = [...new Set(drafts.map((d) => d.mass_id))];
  const templateIds = [...new Set(drafts.map((d) => d.template_id))];
  const dates = [...new Set(drafts.map((d) => d.session_date))];

  const [{ data: massRows }, { data: templateRows }, { data: slotRows }, { data: memberRows }] =
    await Promise.all([
      sb.from("masses").select("id, name, is_active").in("id", massIds),
      sb.from("liturgy_templates").select("id, name").in("id", templateIds),
      sb.from("liturgy_template_slots")
        .select("template_id, position_label, required_gender")
        .in("template_id", templateIds)
        .order("sort_order", { ascending: true }),
      sb.from("members").select("id, full_name, gender").eq("is_active", true),
    ]);

  const massById = new Map(
    ((massRows ?? []) as Array<{ id: string; name: string; is_active: boolean }>).map((m) => [
      m.id,
      m,
    ]),
  );
  const templateNameById = new Map(
    ((templateRows ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  );
  const positionsByTemplate = new Map<string, TemplatePosition[]>();
  for (const s of (slotRows ?? []) as Array<{
    template_id: string;
    position_label: string;
    required_gender: string | null;
  }>) {
    const list = positionsByTemplate.get(s.template_id) ?? [];
    list.push({
      position_label: String(s.position_label),
      required_gender: asGenderRule(s.required_gender),
    });
    positionsByTemplate.set(s.template_id, list);
  }
  const roll: BulkMember[] = ((memberRows ?? []) as Array<{
    id: string;
    full_name: string;
    gender: string | null;
  }>).map((m) => ({ id: m.id, full_name: m.full_name, gender: m.gender }));

  const nameById = new Map(roll.map((m) => [m.id, m.full_name]));

  // Who is already serving on each date, split by Mass, from the state on disk before this batch
  // touched anything. Kept as a snapshot rather than a running set because the two Masses of one
  // Sunday need opposite answers: the second must avoid the first's *new* draw, while the first must
  // still avoid whatever the second already had. One mutable set cannot be both, and folding the
  // two together is how one Sunday ends up with the same person in two Masses.
  const onDiskByDate = new Map<string, Map<string, string[]>>();
  const sameDay = await sb
    .from("liturgy_planned")
    .select("session_date, mass_id, member_id")
    .in("session_date", dates);
  for (const row of (sameDay.data ?? []) as Array<{
    session_date: string;
    mass_id: string;
    member_id: string | null;
  }>) {
    if (!row.member_id) continue;
    const byMass = onDiskByDate.get(row.session_date) ?? new Map<string, string[]>();
    const list = byMass.get(row.mass_id) ?? [];
    list.push(row.member_id);
    byMass.set(row.mass_id, list);
    onDiskByDate.set(row.session_date, byMass);
  }

  // Grown as entries are saved, so the second Mass of a Sunday respects the first one's draw.
  const drawnByDate = new Map<string, Set<string>>();

  const timezone = await getSetting("report_timezone");
  const results: EntryResult[] = [];

  for (const draft of drafts) {
    results.push(
      await saveEntry({
        draft,
        massById,
        templateNameById,
        positionsByTemplate,
        roll,
        nameById,
        onDiskByDate,
        drawnByDate,
        timezone,
        fromRole: g.session.role,
      }),
    );
  }

  await logAudit({
    actor: {
      role: g.session.role,
      memberId: g.session.actor?.id ?? null,
      name: g.session.actor?.name ?? null,
    },
    action: "liturgy_saved",
    entityType: "liturgy_planned",
    meta: {
      requested: drafts.length,
      saved: results.filter((r) => r.ok).length,
      announced: results.filter((r) => r.announced).length,
    },
    ip: req.headers.get("x-forwarded-for"),
  });

  return NextResponse.json({ ok: true, results });
}

async function saveEntry(input: {
  draft: Draft;
  massById: Map<string, { id: string; name: string; is_active: boolean }>;
  templateNameById: Map<string, string>;
  positionsByTemplate: Map<string, TemplatePosition[]>;
  roll: BulkMember[];
  nameById: Map<string, string>;
  onDiskByDate: Map<string, Map<string, string[]>>;
  drawnByDate: Map<string, Set<string>>;
  timezone: string;
  fromRole: string;
}): Promise<EntryResult> {
  const { draft } = input;
  const sb = getSupabaseAdmin();
  const mass = input.massById.get(draft.mass_id);
  const result: EntryResult = {
    session_date: draft.session_date,
    mass_id: draft.mass_id,
    mass_name: mass?.name ?? "Mass",
    ok: false,
    saved: 0,
    unfilled: 0,
    announced: false,
    announcement_id: null,
    message: "",
  };

  if (!mass) return { ...result, message: "That Mass no longer exists." };
  // The modal only offers active Masses. This is the rule rather than the convenience: a request
  // that names a retired Mass would otherwise fill a plan the parish can no longer see anywhere.
  if (!mass.is_active) return { ...result, message: `${mass.name} is not active any more.` };

  const positions = input.positionsByTemplate.get(draft.template_id) ?? [];
  if (positions.length === 0) {
    return { ...result, message: "That template has no positions in it." };
  }

  const { data: existingRows } = await sb
    .from("liturgy_planned")
    .select("member_id")
    .eq("session_date", draft.session_date)
    .eq("mass_id", draft.mass_id);
  const alreadyThere = (existingRows ?? []).filter((r) => (r as { member_id: string | null }).member_id);
  if (alreadyThere.length > 0 && !draft.replace) {
    return {
      ...result,
      message: `${result.mass_name} on ${draft.session_date} already has ${alreadyThere.length} server${
        alreadyThere.length === 1 ? "" : "s"
      }. Tick replace to rebuild it.`,
    };
  }

  // Two sources, unioned: whoever an earlier entry in this same request has just drawn, and
  // whoever was already serving this date in a *different* Mass. The rows being replaced are left
  // out on purpose -- they are about to stop existing, and treating them as taken would make a Mass
  // impossible to refill with the same people it had last week.
  const used = new Set<string>(input.drawnByDate.get(draft.session_date) ?? []);
  for (const [otherMassId, memberIds] of input.onDiskByDate.get(draft.session_date) ?? []) {
    if (otherMassId === draft.mass_id) continue;
    for (const id of memberIds) used.add(id);
  }

  const { slots, unfilled } = drawSlots(positions, input.roll, used);
  input.drawnByDate.set(draft.session_date, used);
  if (slots.length === 0) {
    return {
      ...result,
      unfilled,
      message: "No member on the roll can take any of this template's positions.",
    };
  }

  const { error: delErr } = await sb
    .from("liturgy_planned")
    .delete()
    .eq("session_date", draft.session_date)
    .eq("mass_id", draft.mass_id);
  if (delErr) return { ...result, message: delErr.message };

  const now = new Date().toISOString();
  const { error: insErr } = await sb.from("liturgy_planned").insert(
    slots.map((s, i) => ({
      session_date: draft.session_date,
      mass_id: draft.mass_id,
      position_label: s.position_label,
      member_id: s.member_id,
      free_text: null,
      sort_order: i,
      updated_at: now,
    })),
  );
  if (insErr) return { ...result, message: insErr.message };

  const dateLabel = churchTodayLabel(draft.session_date);
  const lines = rosterLines(
    slots.map((s) => ({ position_label: s.position_label, member_name: input.nameById.get(s.member_id) ?? null })),
  );

  let announcementId: string | null = null;
  if (draft.announce && draft.announce_delete_at) {
    try {
      announcementId = await upsertLiturgyRosterAnnouncement(sb, {
        sessionDate: draft.session_date,
        massId: draft.mass_id,
        title: announcementTitle(result.mass_name, dateLabel),
        body: announcementBody(
          `These are the servers for ${result.mass_name} on ${dateLabel}.`,
          lines,
        ),
        deleteAt: endOfDayInstant(draft.announce_delete_at, input.timezone),
        fromRole: input.fromRole,
      });
    } catch (e) {
      // The roster is saved either way. Reporting this as a failed entry would invite the officer to
      // press Save again, which would redraw the lineup -- so the entry is a success with a note.
      return {
        ...result,
        ok: true,
        saved: slots.length,
        unfilled,
        message: `Saved, but the announcement could not be posted: ${e instanceof Error ? e.message : "unknown error"}`,
      };
    }
  }

  // One notification per announced assignment, carrying the same lines as the announcement. The
  // generic `announcement_posted` event is deliberately not fired as well: it would push a
  // title-only version of the same news and the parish would get told twice about one Sunday.
  if (draft.announce) {
    await pushLiturgyAssignmentsNotification({
      sessionDate: draft.session_date,
      massName: result.mass_name,
      slots: slots.map((s) => ({
        position_label: s.position_label,
        member_name: input.nameById.get(s.member_id) ?? null,
        free_text: null,
      })),
      sendPush: true,
      roster: lines,
    });
  }

  return {
    ...result,
    ok: true,
    saved: slots.length,
    unfilled,
    announced: draft.announce,
    announcement_id: announcementId,
    message: unfilled > 0
      ? `Added with ${slots.length} server${slots.length === 1 ? "" : "s"} from ${input.templateNameById.get(draft.template_id) ?? "the template"}; ${unfilled} position${
          unfilled === 1 ? " had" : "s had"
        } nobody eligible and ${unfilled === 1 ? "was" : "were"} left open.`
      : `Added ${slots.length} server${slots.length === 1 ? "" : "s"} from ${input.templateNameById.get(draft.template_id) ?? "the template"}.`,
  };
}