import type { NextRequest } from "next/server";
import { handleLiturgyGet, handleLiturgyPut } from "@/features/liturgy/server/handlers";

/** LIT-1: session mode, keyed by session id. Same contract as `/api/liturgy/planned`. */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleLiturgyGet(req, { kind: "session", sessionId: id });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleLiturgyPut(req, { kind: "session", sessionId: id });
}