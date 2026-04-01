import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveRoleFromPin } from "@/lib/auth/pin-login";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { signSession } from "@/lib/auth/session";

const bodySchema = z.object({
  pin: z.string().min(4).max(12),
});

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "PIN must be 4–12 characters" }, { status: 400 });
  }

  const role = await resolveRoleFromPin(parsed.data.pin);
  if (!role) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  const token = await signSession(role);
  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
