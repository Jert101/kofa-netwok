import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  default_sunday: z.boolean().optional(),
  default_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
    .nullable()
    .optional(),
  is_active: z.boolean().optional(),
  /** ATT-1 reorder: swap this Mass's position with its neighbour. */
  direction: z.enum(["up", "down"]).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
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

  const sb = getSupabaseAdmin();

  if (parsed.data.direction) {
    return reorderMass(sb, id, parsed.data.direction);
  }

  // `direction` is a command, not a field: it is handled above and must not be written
  // into the masses row.
  const { direction, ...fields } = parsed.data;
  void direction;
  const patch = { ...fields, updated_at: new Date().toISOString() };
  const { error } = await sb.from("masses").update(patch).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Moves a Mass one place up or down.
 *
 * The two rows swap their sort_order rather than taking the midpoint. Gaps in
 * sort_order are harmless, and a midpoint scheme drifts towards fractional values
 * after a few dozen reorders until the orders stop being comparable as numbers.
 *
 * Swapping rather than shifting everything also means a reorder touches two rows, so
 * two admins reordering at once cannot rewrite the whole list out from under each
 * other.
 */
async function reorderMass(
  sb: ReturnType<typeof getSupabaseAdmin>,
  id: string,
  direction: "up" | "down",
): Promise<NextResponse> {
  const { data: current, error: readError } = await sb
    .from("masses")
    .select("id, sort_order")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 400 });
  }
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The immediate neighbour in the direction requested. Sorting by id as a tiebreak
  // keeps the pick stable when two Masses share a sort_order, which is possible before
  // anyone has reordered anything.
  const { data: neighbour, error: neighbourError } = await sb
    .from("masses")
    .select("id, sort_order")
    .neq("id", id)
    .order("sort_order", { ascending: direction === "up" })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (neighbourError) {
    return NextResponse.json({ error: neighbourError.message }, { status: 400 });
  }

  // Already at that end of the list. Reported as success so a double-tap on the last
  // row is not an error in the UI.
  if (!neighbour || neighbour.sort_order === current.sort_order) {
    return NextResponse.json({ ok: true, moved: false });
  }

  const { error: swapError } = await sb
    .from("masses")
    .upsert(
      [
        { id: current.id, sort_order: neighbour.sort_order as number },
        { id: neighbour.id, sort_order: current.sort_order as number },
      ],
      { onConflict: "id" },
    );

  if (swapError) {
    return NextResponse.json({ error: swapError.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, moved: true });
}
