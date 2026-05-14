import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole } from "@/lib/api/guard";
import type { SettingKey } from "@/lib/settings/keys";
import { upsertSettings } from "@/lib/settings/store";

const pinField = z.string().min(4).max(12);

const bodySchema = z
  .object({
    role: z.enum(["admin", "secretary", "member", "officer"]),
    pin: pinField,
    confirm: pinField,
  })
  .refine((d) => d.pin === d.confirm, { message: "PIN does not match confirmation", path: ["confirm"] });

const PIN_HASH_KEY: Record<z.infer<typeof bodySchema>["role"], SettingKey> = {
  admin: "pin_admin_hash",
  secretary: "pin_secretary_hash",
  member: "pin_member_hash",
  officer: "pin_officer_hash",
};

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
    const flat = parsed.error.flatten();
    const msg = flat.fieldErrors.confirm?.[0] ?? flat.formErrors[0] ?? "Invalid PIN request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const salt = 10;
  const key = PIN_HASH_KEY[parsed.data.role];
  await upsertSettings({
    [key]: bcrypt.hashSync(parsed.data.pin, salt),
  });

  return NextResponse.json({ ok: true });
}
