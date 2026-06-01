import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const schema = z.object({
  first_name: z.string().min(1).max(100).trim(),
  last_name: z.string().min(1).max(100).trim(),
  middle_initial: z.string().max(2).trim().optional().default(""),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  gender: z.enum(["male", "female"]),
  contact_number: z.string().min(7).max(20).trim(),
});

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return NextResponse.json({ error: first?.message ?? "Invalid input" }, { status: 400 });
  }

  const { first_name, last_name, middle_initial, date_of_birth, gender, contact_number } = parsed.data;

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("registration_requests").insert({
    first_name,
    last_name,
    middle_initial: middle_initial || null,
    date_of_birth,
    gender,
    contact_number,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
