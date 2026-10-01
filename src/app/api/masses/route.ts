import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, validationFailed } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary", "admin", "officer"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();

  // Inactive Masses are returned too, and flagged rather than filtered out. The
  // roster picks need only the active ones, but a secretary looking at a past session
  // has to be able to see that the Mass it was for has since been deactivated —
  // hiding it makes old history look like a mistake.
  const { data, error } = await sb
    .from("masses")
    .select("id, name, default_sunday, default_time, is_active, sort_order")
    // sort_order first so the catalog reads in the order the admin arranged, then
    // name as the tiebreak for rows that have not been given an explicit order yet.
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return internalError(error.message);
  }
  return jsonOk({ masses: data ?? [] });
}

const postSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  default_sunday: z.boolean().optional(),
  default_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
    .nullable()
    .optional(),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "officer"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return validationFailed("Invalid body.", {});
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return validationFailed("Invalid body.", {});

  const sb = getSupabaseAdmin();

  // New Masses go to the end of the list rather than sorting themselves into the
  // middle by name. "Farewell" would otherwise appear between two Sunday Masses and
  // quietly change the order the admin set up.
  const { data: last } = await sb
    .from("masses")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await sb
    .from("masses")
    .insert({
      name: parsed.data.name,
      default_sunday: parsed.data.default_sunday ?? false,
      default_time: parsed.data.default_time ?? null,
      sort_order: ((last?.sort_order as number | undefined) ?? -1) + 1,
    })
    .select("id")
    .single();

  if (error) {
    return validationFailed(error.message, {});
  }
  return jsonOk({ id: data?.id });
}
