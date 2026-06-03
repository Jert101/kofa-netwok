import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const updateSchema = z.object({
  first_name: z.string().min(1).max(100).trim().optional(),
  last_name: z.string().min(1).max(100).trim().optional(),
  middle_initial: z.string().max(1).trim().optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(["male", "female"]).optional(),
  contact_number: z.string().min(7).max(20).trim().optional(),
});

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

  const { action, ...fields } = json as Record<string, unknown>;

  const sb = getSupabaseAdmin();

  const { data: request, error: fetchErr } = await sb
    .from("registration_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (action === "update") {
    const parsed = updateSchema.safeParse(fields);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
    }
    const updates: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed.data)) {
      if (val !== undefined) updates[key] = val;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    const { error: upErr } = await sb.from("registration_requests").update(updates).eq("id", id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "change-status") {
    const newStatus = typeof fields.new_status === "string" ? fields.new_status : null;
    if (!newStatus || !["pending", "approved", "rejected"].includes(newStatus)) {
      return NextResponse.json({ error: "new_status must be 'pending', 'approved', or 'rejected'" }, { status: 400 });
    }

    if (newStatus === request.status) {
      return NextResponse.json({ error: "Status is already " + newStatus }, { status: 400 });
    }

    if (request.status === "approved") {
      const mi = request.middle_initial ? ` ${request.middle_initial}.` : "";
      const fullName = `${request.first_name}${mi} ${request.last_name}`;
      await sb.from("members").delete().eq("full_name", fullName).eq("date_of_birth", request.date_of_birth);
    }

    if (newStatus === "approved") {
      const mi = request.middle_initial ? ` ${request.middle_initial}.` : "";
      const full_name = `${request.first_name}${mi} ${request.last_name}`;
      const { error: insertErr } = await sb.from("members").insert({
        full_name,
        date_of_birth: request.date_of_birth,
        gender: request.gender,
        contact_number: request.contact_number,
      });
      if (insertErr) {
        if (insertErr.code === "23505") {
          return NextResponse.json({ error: "A member with this name already exists" }, { status: 409 });
        }
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus !== "pending") updates.reviewed_at = new Date().toISOString();
    else updates.reviewed_at = null;
    const { error: upErr } = await sb.from("registration_requests").update(updates).eq("id", id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (typeof action !== "string" || !["approve", "reject", "update"].includes(action)) {
    return NextResponse.json({ error: "action must be 'approve', 'reject', 'update', or 'change-status'" }, { status: 400 });
  }

  if (request.status !== "pending") {
    return NextResponse.json({ error: "Request already reviewed" }, { status: 400 });
  }

  const status = action === "approve" ? "approved" : "rejected";

  if (action === "approve") {
    const mi = request.middle_initial ? ` ${request.middle_initial}.` : "";
    const full_name = `${request.first_name}${mi} ${request.last_name}`;

    const { error: insertErr } = await sb.from("members").insert({
      full_name,
      date_of_birth: request.date_of_birth,
      gender: request.gender,
      contact_number: request.contact_number,
    });

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
