import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { fetchOverdue } from "@/lib/payments/server/ledger";
import { round2 } from "@/lib/payments/proration";
import { churchToday } from "@/lib/time/church-time";

/**
 * PAY-5: the overdue list, and its CSV.
 *
 * One endpoint for both because the spec's acceptance criterion is "CSV exports match the screen", and
 * the only way that stays true is for both to come out of the same sorted array. A separately written
 * CSV drifts from the list the moment either side changes.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer", "admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const structureId = url.searchParams.get("structure_id");
  const batch = url.searchParams.get("batch");

  const asOf = churchToday(await getSetting("report_timezone"));

  let rows;
  try {
    rows = await fetchOverdue({
      structureId: structureId ?? undefined,
      batch: batch ?? undefined,
      asOf,
    });
  } catch (e) {
    console.error("[treasurer/overdue] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build the overdue list.");
  }

  if (url.searchParams.get("format") === "csv") return csvResponse(rows, asOf);

  return jsonOk({
    as_of: asOf,
    // Two numbers, because they answer different questions. `count` is how many people to ring;
    // `row_count` is how many structures they are behind on, and is what the CSV will contain.
    count: new Set(rows.map((r) => r.memberId)).size,
    row_count: rows.length,
    total_outstanding: round2(rows.reduce((n, r) => n + r.remaining, 0)),
    filters: { structure_id: structureId, batch },
    rows,
  });
}

/** RFC 4180 quoting: a comma, a quote, a newline, or a stray edge space all need the quotes. */
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvResponse(
  rows: ReadonlyArray<{
    memberName: string;
    batch: string | null;
    structureName: string;
    amount: number;
    paid: number;
    due: number;
    remaining: number;
    monthsOverdue: number;
  }>,
  asOf: string,
): Response {
  const header = [
    "Member",
    "Batch",
    "Structure",
    "Amount",
    "Paid",
    "Due to date",
    "Outstanding",
    "Months overdue",
  ];

  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.memberName,
        row.batch,
        row.structureName,
        row.amount.toFixed(2),
        row.paid.toFixed(2),
        row.due.toFixed(2),
        row.remaining.toFixed(2),
        String(row.monthsOverdue),
      ]
        .map(cell)
        .join(","),
    );
  }

  // A BOM, because the parish's bookkeeper opens these in Excel on Windows and without it every accented
  // name arrives as mojibake.
  const body = `﻿${lines.join("\r\n")}\r\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="overdue-${asOf}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}