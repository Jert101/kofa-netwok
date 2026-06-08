import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAllSettings } from "@/lib/settings/store";
import {
  buildPaymentStructurePdf,
  type PaymentStatusRow,
} from "@/lib/reports/payment-structures-pdf";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "treasurer"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();

  const { data: structure, error: sErr } = await sb
    .from("payment_structures")
    .select("*")
    .eq("id", id)
    .single();

  if (sErr || !structure) {
    return NextResponse.json({ error: "Payment structure not found" }, { status: 404 });
  }

  const { data: members } = await sb.from("members").select("id, full_name").eq("is_active", true).order("full_name");

  if (!members) {
    return NextResponse.json({ error: "No members found" }, { status: 404 });
  }

  const { data: payments } = await sb
    .from("payments")
    .select("member_id, amount_paid")
    .eq("payment_structure_id", id);

  const paidMap = new Map<string, number>();
  for (const p of payments ?? []) {
    paidMap.set(p.member_id, (paidMap.get(p.member_id) ?? 0) + Number(p.amount_paid));
  }

  const rows: PaymentStatusRow[] = members.map((m) => {
    const totalPaid = paidMap.get(m.id) ?? 0;
    const totalAmount = Number(structure.amount);
    return {
      memberName: m.full_name,
      totalAmount,
      totalPaid,
      remaining: totalAmount - totalPaid,
    };
  });

  const allSettings = await getAllSettings();
  const pdf = buildPaymentStructurePdf({
    churchName: allSettings.church_name ?? "Church",
    structureName: structure.name,
    deadline: structure.deadline,
    generatedAt: new Date(),
    rows,
  });

  const filename = `${structure.name.toLowerCase().replace(/\s+/g, "-")}-report.pdf`;

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
