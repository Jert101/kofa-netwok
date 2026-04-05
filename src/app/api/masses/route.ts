import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary", "admin", "officer"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("masses")
    .select("id, name, default_sunday")
    .eq("is_active", true)
    .order("default_sunday", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ masses: data ?? [] });
}

const postSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  default_sunday: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "officer"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("masses")
    .insert({
      name: parsed.data.name,
      default_sunday: parsed.data.default_sunday ?? false,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ id: data?.id });
}
