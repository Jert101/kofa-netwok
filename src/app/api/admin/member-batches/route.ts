import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import {
  badRequest,
  conflict,
  internalError,
  jsonOk,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { getClientIp } from "@/lib/auth/ip-hash";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { batchInUseMessage } from "@/features/members/batches";

/**
 * Batches are batch years (module 03, MEM-6). Registration and the member
 * directory both filter on them, so deleting one that people still point at would
 * quietly drop a filter rather than delete a person.
 */

const postSchema = z.object({
  year: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Use a four digit year.")
    .refine((y) => Number(y) >= 1900 && Number(y) <= 9999, "That year does not make sense."),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "treasurer"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();

  const { data, error } = await sb
    .from("member_batches")
    .select("id, year, created_at")
    .order("year", { ascending: false });

  if (error) {
    return internalError("Could not load the batch years.");
  }

  const batches = (data ?? []) as { id: string; year: string; created_at: string }[];

  // One grouped count instead of a query per year.
  const [members, structures] = await Promise.all([
    sb.from("members").select("batch"),
    sb.from("payment_structures").select("batch, for_all"),
  ]);

  const counts = new Map<string, number>();
  for (const row of members.data ?? []) {
    const year = (row as { batch: string | null }).batch;
    if (!year) continue;
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }

  // A structure scoped to that batch blocks its deletion even when it holds no
  // members, so the panel needs to know about it before the admin tries.
  const structureCounts = new Map<string, number>();
  for (const row of structures.data ?? []) {
    const { batch: year, for_all: forAll } = row as {
      batch: string | null;
      for_all: boolean;
    };
    if (!year || forAll) continue;
    structureCounts.set(year, (structureCounts.get(year) ?? 0) + 1);
  }

  return jsonOk({
    batches: batches.map((b) => ({
      ...b,
      member_count: counts.get(b.year) ?? 0,
      structure_count: structureCounts.get(b.year) ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed("Check the year and try again.", zodFields(parsed.error));
  }

  const sb = getSupabaseAdmin();

  // Creating a year that already exists is a no-op rather than an error: the
  // import flow can ask for the same year twice in one session.
  const { data: existing } = await sb
    .from("member_batches")
    .select("id, year")
    .eq("year", parsed.data.year)
    .maybeSingle();

  if (existing) {
    return jsonOk({ batch: existing, created: false });
  }

  const { data, error } = await sb
    .from("member_batches")
    .insert({ year: parsed.data.year })
    .select("id, year, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return conflict("CONFLICT", "That batch year already exists.");
    }
    return internalError("Could not add that year.");
  }

  await logAudit({
    action: "batch_created",
    actor: {
      role: g.session.role,
      memberId: g.session.actor?.id ?? null,
      name: g.session.actor?.name ?? null,
    },
    entityType: "member_batch",
    entityId: data?.id as string,
    ip: getClientIp(req.headers),
    meta: { year: parsed.data.year },
  });

  return jsonOk({ batch: data, created: true }, { status: 201 });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const parsed = deleteSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed("Choose a year to remove.", zodFields(parsed.error));
  }

  const sb = getSupabaseAdmin();

  const { data: batch } = await sb
    .from("member_batches")
    .select("id, year")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!batch) {
    return badRequest("That year is already gone.");
  }

  const [members, structures] = await Promise.all([
    sb
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("batch", batch.year),
    sb
      .from("payment_structures")
      .select("id", { count: "exact", head: true })
      .eq("batch", batch.year),
  ]);

  if (members.error || structures.error) {
    return internalError("Could not check whether that year is in use.");
  }

  // MEM-6: a year that members or payment structures still point at is not
  // removed. Deleting it would leave those records pointing at a batch that no
  // longer exists, which quietly breaks the filter rather than looking like an
  // error. Both are checked because a batch can be referenced by a structure even
  // with nobody in it yet.
  const memberCount = members.count ?? 0;
  const structureCount = structures.count ?? 0;

  if (memberCount > 0 || structureCount > 0) {
    return conflict("CONFLICT", batchInUseMessage(batch.year, memberCount, structureCount));
  }

  const { error } = await sb.from("member_batches").delete().eq("id", parsed.data.id);
  if (error) {
    return internalError("Could not remove that year.");
  }

  await logAudit({
    action: "batch_deleted",
    actor: {
      role: g.session.role,
      memberId: g.session.actor?.id ?? null,
      name: g.session.actor?.name ?? null,
    },
    entityType: "member_batch",
    entityId: parsed.data.id,
    ip: getClientIp(req.headers),
    meta: { year: batch.year },
  });

  return jsonOk({ ok: true, year: batch.year });
}
