import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, validationFailed, zodFields } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAllSettings } from "@/lib/settings/store";
import { logAudit } from "@/lib/audit/log-audit";
import { dateSchema } from "@/features/liturgy/server/schemas";
import { loadUpcomingDays } from "@/features/liturgy/server/upcoming-data";
import { buildLiturgySheetPdf } from "@/lib/liturgy/sheet-pdf";
import { formatLongDay, type SheetMass } from "@/lib/liturgy/sheet";
import { formatMassTime } from "@/lib/liturgy/upcoming";
import { z } from "zod";

export const runtime = "nodejs";

const sheetQuerySchema = z.object({ date: dateSchema });

/**
 * LIT-7: the printable ministry schedule for one date.
 *
 * Reads through `loadUpcomingDays` rather than querying the tables again, so the sheet, the
 * officer's screen and "Needs attention" cannot disagree about whose plan is in force on a date.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["officer", "admin"]);
  if (!g.ok) return g.response;

  const parsed = sheetQuerySchema.safeParse({
    date: new URL(req.url).searchParams.get("date") ?? "",
  });
  if (!parsed.success) {
    return validationFailed("Check the date and try again.", zodFields(parsed.error));
  }
  const date = parsed.data.date;

  const sb = getSupabaseAdmin();

  let masses: SheetMass[];
  try {
    masses = await sheetMassesFor(sb, date);
  } catch (e) {
    console.error("[liturgy/sheet] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build the schedule.");
  }

  let churchName = "Knights of the Altar";
  let churchAddress = "";
  try {
    const settings = await getAllSettings();
    churchName = settings.church_name || churchName;
    churchAddress = settings.church_address || "";
  } catch {
    // A settings read failure must not block the print: the header falls back to the default name.
  }

  const generatedAt = new Date();
  const pdf = buildLiturgySheetPdf({
    churchName,
    churchAddress,
    dateLabel: formatLongDay(date),
    generatedAt,
    generatedAtLabel: `Generated: ${generatedAt.toLocaleString("en-PH")}`,
    masses,
  });

  await logAudit({
    action: "liturgy_sheet_downloaded",
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    entityType: "liturgy_date",
    entityId: date,
    meta: {
      masses: masses.length,
      positions: masses.reduce((n, m) => n + m.slots.length, 0),
      pages: pdf.pages,
      one_page: pdf.onePage,
    },
    ip: req.headers.get("x-forwarded-for"),
  });

  return new Response(pdf.bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ministry-schedule-${date}.pdf"`,
      // Private ministry assignments, and the page needs to know when the sheet spilled past one
      // page so it can say so rather than leaving the officer to find out in the sacristy.
      "X-Liturgy-Sheet-Pages": String(pdf.pages),
      "X-Liturgy-Sheet-One-Page": pdf.onePage ? "true" : "false",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Every active Mass for the date, with whoever is on it.
 *
 * Masses with nobody assigned are included with an empty slot list rather than dropped: a printed
 * sheet is the record of what the day looks like, and a blank band under a Mass name is the
 * clearest possible statement that it is unstaffed.
 */
async function sheetMassesFor(sb: ReturnType<typeof getSupabaseAdmin>, date: string): Promise<SheetMass[]> {
  const [masses, days] = await Promise.all([
    sb
      .from("masses")
      .select("id, name, default_time")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    loadUpcomingDays(sb, { start: date, end: date, viewerMemberId: null }),
  ]);

  const byMassId = new Map(days[0]?.masses.map((m) => [m.mass_id, m]) ?? []);

  return ((masses.data ?? []) as Array<{ id: string; name: string | null; default_time: string | null }>).map(
    (m) => {
      const planned = byMassId.get(String(m.id));
      return {
        mass_id: String(m.id),
        mass_name: String(m.name ?? "Mass"),
        time_label: formatMassTime(m.default_time),
        slots: (planned?.slots ?? []).map((s) => ({
          position_label: s.position_label,
          member_name: s.member_name ?? s.free_text,
        })),
      };
    },
  );
}