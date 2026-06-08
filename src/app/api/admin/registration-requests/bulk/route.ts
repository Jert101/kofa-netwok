import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: { action?: string; ids?: string[] };
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, ids } = json;

  if (!action || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  let query = sb.from("registration_requests").select("*").eq("status", "pending");

  if (ids && Array.isArray(ids) && ids.length > 0) {
    query = query.in("id", ids);
  }

  const { data: pending, error: fetchErr } = await query;

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ error: "No matching pending requests" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const newStatus = action === "approve" ? "approved" : "rejected";

  let skipped = 0;
  let approveTargets = pending;

  if (action === "approve") {
    const { data: existingMembers } = await sb
      .from("members")
      .select("full_name")
      .eq("is_active", true);
    const existingNames = new Set(
      (existingMembers ?? []).map((m) => m.full_name.trim().toLowerCase())
    );

    const memberInserts: Record<string, unknown>[] = [];
    const kept: typeof pending = [];
    const seenInBatch = new Set<string>();
    for (const r of pending) {
      const mi = r.middle_initial ? ` ${r.middle_initial}.` : "";
      const full_name = `${r.first_name}${mi} ${r.last_name}`;
      const key = full_name.trim().toLowerCase();
      if (existingNames.has(key) || seenInBatch.has(key)) {
        skipped++;
        continue;
      }
      seenInBatch.add(key);
      kept.push(r);
      memberInserts.push({
        full_name,
        date_of_birth: r.date_of_birth,
        gender: r.gender,
        contact_number: r.contact_number,
        batch: r.batch || null,
      });
    }

    approveTargets = kept;

    if (memberInserts.length > 0) {
      const { error: insertErr } = await sb.from("members").insert(memberInserts);
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }
  }

  const pendingIds = approveTargets.map((r) => r.id);
  if (pendingIds.length > 0) {
    const { error: updateErr } = await sb
      .from("registration_requests")
      .update({ status: newStatus, reviewed_at: now })
      .in("id", pendingIds);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: approveTargets.length, skipped });
}
