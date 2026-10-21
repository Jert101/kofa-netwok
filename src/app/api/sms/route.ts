import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getIntegerSetting } from "@/lib/settings/store";
import { normalizePhone } from "@/lib/sms/send";

const SmsType = z.enum(["assignment", "announcement", "birthday", "individual", "inactivity_notice"]);

const postSchema = z.object({
  message: z.string().trim().min(1).max(1600),
  type: SmsType.default("individual"),
  /** One specific phone number, for individual messages. */
  recipient: z.string().optional(),
  /** One specific member, for individual messages. */
  member_id: z.string().uuid().optional(),
});

/** How many to return in one page. */
const PAGE_SIZE = 100;

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const url = new URL(req.url);

  let q = sb
    .from("sms_queue")
    .select("id, recipient, member_id, message, type, priority, status, retries, max_retries, dedupe_key, created_at, sent_at, error")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const status = url.searchParams.get("status");
  if (status && ["pending", "sent", "failed"].includes(status)) {
    q = q.eq("status", status);
  }

  const type = url.searchParams.get("type");
  if (type && SmsType.safeParse(type).success) {
    q = q.eq("type", type);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Today's count in the parish's own day.
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const { count: sentToday } = await sb
    .from("sms_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("created_at", `${today}T00:00:00Z`)
    .lt("created_at", `${today}T23:59:59Z`);

  const dailyLimit = await getIntegerSetting("sms_daily_limit");

  return NextResponse.json({
    ok: true,
    queue: (data ?? []).map((row) => ({
      id: row.id,
      recipient: row.recipient,
      member_id: row.member_id,
      message: row.message,
      type: row.type,
      priority: row.priority,
      status: row.status,
      retries: row.retries,
      max_retries: row.max_retries,
      dedupe_key: row.dedupe_key,
      created_at: row.created_at,
      sent_at: row.sent_at,
      error: row.error,
    })),
    sentToday: sentToday ?? 0,
    dailyLimit,
  });
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That could not be read." }, { status: 400 });
  }

  const { message, type, recipient: rawRecipient, member_id } = parsed.data;

  const sb = getSupabaseAdmin();

  // Resolve the recipient phone number.
  let recipient = rawRecipient;
  let memberName: string | null = null;
  if (member_id && !recipient) {
    const { data: member, error: memberErr } = await sb
      .from("members")
      .select("full_name, contact_number")
      .eq("id", member_id)
      .maybeSingle();
    if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
    if (!member) return NextResponse.json({ error: "That member does not exist." }, { status: 404 });
    recipient = member.contact_number ?? null;
    memberName = member.full_name ?? null;
  }

  const normalized = normalizePhone(recipient ?? null);
  if (!normalized) {
    return NextResponse.json({ error: "A valid Philippine phone number is required." }, { status: 400 });
  }

  // Personalize {name} when we know the member.
  const body = memberName ? message.replace(/\{name\}/g, String(memberName)) : message;

  // Dedupe: do not queue the same message for the same person again.
  const dedupeKey = `${type}:${normalized}:${Buffer.from(body).toString("hex").slice(0, 16)}`;

  const { data: existing } = await sb
    .from("sms_queue")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .eq("status", "sent")
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Already sent to this person." });
  }

  const { data, error } = await sb
    .from("sms_queue")
    .insert({
      recipient: normalized,
      member_id: member_id ?? null,
      message: body,
      type,
      priority: type === "announcement" ? 2 : 1,
      dedupe_key: dedupeKey,
    })
    .select("id, status, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    id: data?.id ?? null,
    status: data?.status ?? "pending",
    created_at: data?.created_at ?? null,
  });
}
