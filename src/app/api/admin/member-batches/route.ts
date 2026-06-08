import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "treasurer"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("member_batches")
    .select("id, year")
    .order("year", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ batches: data ?? [] });
}

const postSchema = z.object({
  year: z.string().regex(/^\d{4}$/, "Year must be a 4-digit number"),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try { json = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("member_batches")
    .insert({ year: parsed.data.year })
    .select("id, year")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This batch year already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ batch: data });
}

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try { json = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = deleteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("member_batches")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
