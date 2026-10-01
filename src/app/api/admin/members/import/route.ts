import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, validationFailed, zodFields } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { getClientIp } from "@/lib/auth/ip-hash";
import { commitImport, previewImport } from "@/features/members/server/import-members";
import { MAX_IMPORT_BYTES } from "@/features/members/import-csv";

const bodySchema = z.object({
  csv: z.string().min(1, "Choose a CSV file first."),
  createMissingBatches: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return validationFailed("Could not read the file.", { _form: "Could not read the file." });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed("Check the file and try again.", zodFields(parsed.error));
  }

  if (new TextEncoder().encode(parsed.data.csv).length > MAX_IMPORT_BYTES) {
    return validationFailed("That file is too large.", {
      _form: "Keep the file under 1 MB.",
    });
  }

  try {
    if (req.nextUrl.searchParams.get("mode") === "commit") {
      const result = await commitImport(parsed.data.csv, {
        createMissingBatches: parsed.data.createMissingBatches,
      });
      await logAudit({
        action: "members_imported",
        actor: {
          role: g.session.role,
          memberId: g.session.actor?.id ?? null,
          name: g.session.actor?.name ?? null,
        },
        entityType: "member",
        entityId: null,
        ip: getClientIp(req.headers),
        meta: {
          imported: result.counts.imported,
          duplicate: result.counts.duplicate,
          invalid: result.counts.invalid,
        },
      });
      return jsonOk(result);
    }

    return jsonOk(await previewImport(parsed.data.csv));
  } catch (e) {
    console.error(
      "[admin/members/import] failed:",
      e instanceof Error ? e.message : e,
    );
    return internalError("Could not read that file.");
  }
}
