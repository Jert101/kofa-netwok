import type { NextRequest } from "next/server";
import { badRequest } from "@/lib/api/response";
import { handleLiturgyGet, handleLiturgyPut } from "@/features/liturgy/server/handlers";
import { plannedQuerySchema } from "@/features/liturgy/server/schemas";

/** LIT-1: planned mode, keyed by date and Mass. */

function readTarget(url: URL) {
  const parsed = plannedQuerySchema.safeParse({
    date: url.searchParams.get("date"),
    mass_id: url.searchParams.get("mass_id"),
  });
  if (!parsed.success) return null;
  return {
    kind: "planned" as const,
    sessionDate: parsed.data.date,
    massId: parsed.data.mass_id,
  };
}

export async function GET(req: NextRequest) {
  const target = readTarget(new URL(req.url));
  if (!target) return badRequest("Provide date=YYYY-MM-DD and mass_id.");
  return handleLiturgyGet(req, target);
}

export async function PUT(req: NextRequest) {
  const target = readTarget(new URL(req.url));
  if (!target) return badRequest("Provide date=YYYY-MM-DD and mass_id.");
  return handleLiturgyPut(req, target);
}