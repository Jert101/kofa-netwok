import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = json as { action?: string };
  if (!action || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  const { data: request, error: fetchErr } = await sb
    .from("registration_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (request.status !== "pending") {
    return NextResponse.json({ error: "Request already reviewed" }, { status: 400 });
  }

  const status = action === "approve" ? "approved" : "rejected";

  if (action === "approve") {
    const mi = request.middle_initial ? ` ${request.middle_initial}.` : "";
    const full_name = `${request.first_name}${mi} ${request.last_name}`;

    const { error: insertErr } = await sb.from("members").insert({ full_name });

    if (insertErr) {
      if (insertErr.code === "23505") {
        return NextResponse.json({ error: "A member with this name already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  const { error: updateErr } = await sb
    .from("registration_requests")
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
