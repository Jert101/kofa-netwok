import { NextResponse } from "next/server";
import { getVapidConfig } from "@/lib/push/vapid";

export async function GET() {
  const cfg = getVapidConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Push is not configured on this server" }, { status: 503 });
  }
  return NextResponse.json({ publicKey: cfg.publicKey });
}
