import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole } from "@/lib/api/guard";
import { upsertSettings } from "@/lib/settings/store";

const pinField = z.string().min(4).max(12);

const bodySchema = z
  .object({
    admin_pin: pinField,
    admin_confirm: pinField,
    secretary_pin: pinField,
    secretary_confirm: pinField,
    member_pin: pinField,
    member_confirm: pinField,
  })
  .refine((d) => d.admin_pin === d.admin_confirm, { message: "Admin PIN mismatch", path: ["admin_confirm"] })
  .refine((d) => d.secretary_pin === d.secretary_confirm, {
    message: "Secretary PIN mismatch",
    path: ["secretary_confirm"],
  })
  .refine((d) => d.member_pin === d.member_confirm, { message: "Member PIN mismatch", path: ["member_confirm"] });

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors[0] ?? "Invalid PINs";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const salt = 10;
  await upsertSettings({
    pin_admin_hash: bcrypt.hashSync(parsed.data.admin_pin, salt),
    pin_secretary_hash: bcrypt.hashSync(parsed.data.secretary_pin, salt),
    pin_member_hash: bcrypt.hashSync(parsed.data.member_pin, salt),
  });

  return NextResponse.json({ ok: true });
}
