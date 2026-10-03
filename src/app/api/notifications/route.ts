import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify/notify";
import { INBOX_ROLES } from "@/lib/notify/events";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [...INBOX_ROLES]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";

  let q = sb
    .from("notifications")
    .select("id, from_role, to_role, title, body, link, read_at, created_at")
    .eq("to_role", g.session.role)
    .order("created_at", { ascending: false })
    .limit(50);

  if (unreadOnly) q = q.is("read_at", null);

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ notifications: data ?? [] });
}

const postSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
});

/**
 * An officer writing to the secretary by hand.
 *
 * This is the one notification that is a person speaking rather than a system reporting, which is
 * why it is the only event whose push goes out without waiting for the recipient to open their
 * inbox: somebody chose to interrupt them. The title the author typed is kept, because "Question
 * about the February report" and "Question" carry very different amounts of information.
 */
export async function POST(req: NextRequest) {
  // An officer writing to the office by hand. The direct note goes to the other role, because a
  // message between admin and secretary is the one unstructured exchange this app allows. The super
  // admin approves; they do not correspond.
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
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

  const toRole = g.session.role === "admin" ? "secretary" : "admin";

  const outcome = await notify(
    "direct_note",
    {
      role: toRole,
      title: parsed.data.title,
      body: parsed.data.body ?? "",
    },
    { fromRole: g.session.role },
  );

  if (outcome.inbox === "failed") {
    return NextResponse.json({ error: "Could not save the message" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
