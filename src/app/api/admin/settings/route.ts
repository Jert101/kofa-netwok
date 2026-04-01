import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getAllSettings, upsertSettings } from "@/lib/settings/store";

const patchSchema = z.object({
  church_name: z.string().min(1).max(200).optional(),
  church_address: z.string().max(500).optional(),
  report_title: z.string().min(1).max(200).optional(),
  report_timezone: z.string().min(1).max(80).optional(),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const all = await getAllSettings();
  return NextResponse.json({
    church_name: all.church_name ?? "",
    church_address: all.church_address ?? "",
    report_title: all.report_title ?? "",
    report_timezone: all.report_timezone ?? "UTC",
  });
}

export async function PATCH(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const payload: Record<string, string> = {};
  if (parsed.data.church_name !== undefined) payload.church_name = parsed.data.church_name;
  if (parsed.data.church_address !== undefined) payload.church_address = parsed.data.church_address;
  if (parsed.data.report_title !== undefined) payload.report_title = parsed.data.report_title;
  if (parsed.data.report_timezone !== undefined) payload.report_timezone = parsed.data.report_timezone;

  await upsertSettings(payload as Parameters<typeof upsertSettings>[0]);
  return NextResponse.json({ ok: true });
}
