import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { drawSlots, type BulkMember } from "@/lib/liturgy/bulk-assign";
import { asGenderRule } from "@/lib/liturgy/rules";

/**
 * Draw a server for the positions that do not have one yet.
 *
 * This used to happen inside the save, which meant the announcement and the notification were the
 * only description of a lineup nobody had looked at. It is a separate step now so the officer sees
 * the draw, can change anyone in it, and what gets saved is what they approved.
 *
 * The rule that keeps two Masses on one Sunday from getting the same person is enforced here rather
 * than in the browser, because answering it needs to know who is already serving that date -- which
 * lives in the database, not in the modal. Rows that already have a member are passed through
 * untouched, so drawing twice fills the gaps instead of throwing away the first draw.
 */

const rowSchema = z.object({
  position_label: z.string().trim().min(1).max(80),
  required_gender: z.enum(["male", "female", "any"]).optional(),
  /** Present means the officer picked this one; absent means "draw one". */
  member_id: z.string().uuid().optional(),
});

const bodySchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date of the Mass first."),
  mass_id: z.string().uuid("Choose which Mass this is first."),
  rows: z.array(rowSchema).min(1, "Add at least one position first.").max(48),
});

export async function POST(req: NextRequest) {
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
    // Each field carries its own message rather than zod's default, because "Invalid UUID" is the
    // answer the officer got when this button was reachable with nothing chosen: technically true and
    // useless. The dialog checks first now, but a crafted request should still get a sentence.
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That could not be read." },
      { status: 400 },
    );
  }
  const { session_date, mass_id, rows } = parsed.data;

  const sb = getSupabaseAdmin();

  const [{ data: memberRows }, { data: sameDay }] = await Promise.all([
    sb.from("members").select("id, full_name, gender").eq("is_active", true),
    sb
      .from("liturgy_planned")
      .select("mass_id, member_id")
      .eq("session_date", session_date),
  ]);

  const roll: BulkMember[] = ((memberRows ?? []) as Array<{
    id: string;
    full_name: string;
    gender: string | null;
  }>).map((m) => ({ id: m.id, full_name: m.full_name, gender: m.gender }));

  const filledNames = new Map(
    roll.map((m) => [m.id, m.full_name] as const),
  );

  // Everyone already serving that date in a *different* Mass, plus whoever this screen already has
  // picked. The rows about to be replaced for this Mass are excluded: they are about to stop existing,
  // and counting them would make a Mass impossible to refill with the same people it had last week.
  const used = new Set<string>();
  for (const row of (sameDay ?? []) as Array<{ mass_id: string; member_id: string | null }>) {
    if (row.member_id && row.mass_id !== mass_id) used.add(row.member_id);
  }
  for (const row of rows) if (row.member_id) used.add(row.member_id);

  const needsDraw = rows.filter((r) => !r.member_id).map((r) => ({
    position_label: r.position_label,
    required_gender: asGenderRule(r.required_gender),
  }));

  const { slots, unfilled } = drawSlots(needsDraw, roll, used);

  const drawn = slots.map((s) => ({
    position_label: s.position_label,
    member_id: s.member_id,
    member_name: filledNames.get(s.member_id) ?? null,
  }));

  // Back in the order the officer listed them, not the order the draw happened to produce. Sorting by
  // type here would silently reorder the lineup, which is the thing they arranged. Matched through a
  // queue per label rather than a map, because a parish may have two rows for one position -- two
  // candles, say -- and a map would hand both of them the same person.
  const queue = new Map<string, typeof drawn>();
  for (const d of drawn) {
    const list = queue.get(d.position_label) ?? [];
    list.push(d);
    queue.set(d.position_label, list);
  }

  const result = rows.map((r) => {
    if (r.member_id) {
      return {
        position_label: r.position_label,
        member_id: r.member_id,
        member_name: filledNames.get(r.member_id) ?? null,
      };
    }
    // An empty id means either the person went inactive since they were picked, or nobody was left who
    // fits. The save refuses the first; the message below explains the second.
    return queue.get(r.position_label)?.shift() ?? {
      position_label: r.position_label,
      member_id: "",
      member_name: null,
    };
  });

  return NextResponse.json({
    ok: true,
    slots: result,
    unfilled,
    // Said plainly because "nothing happened" and "every candidate was already booked" look identical
    // on an empty screen, and they are different problems with different fixes.
    message:
      unfilled === 0
        ? null
        : `${unfilled} position${unfilled === 1 ? " had" : "s had"} nobody left who fits. Every active member is either already serving that day or is the wrong gender for it.`,
  });
}