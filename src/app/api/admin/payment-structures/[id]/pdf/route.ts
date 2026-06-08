import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatNameLastFirst } from "@/lib/members/name-format";
import { getAllSettings } from "@/lib/settings/store";
import {
  buildPaymentStructurePdf,
  type PaymentStatusRow,
} from "@/lib/reports/payment-structures-pdf";

type Ctx = { params: Promise<{ id: string }> };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  const { data: payments } = await sb
    .from("payments")
    .select("member_id, amount_paid, paid_at")
    .eq("payment_structure_id", id)
    .eq("voided", false);

  const isForAll = structure.for_all !== false;
  let membersQuery = sb
    .from("members")
    .select("id, full_name, batch");

  if (isForAll) {
    membersQuery = membersQuery.eq("is_active", true);
  } else {
    membersQuery = membersQuery.in("id", Array.from(new Set((payments ?? []).map((p) => p.member_id))));
    if (structure.batch) {
      membersQuery = membersQuery.eq("batch", structure.batch);
    }
  }

  const { data: members } = await membersQuery.order("full_name");

  if (!members) {
    return NextResponse.json({ error: "No members found" }, { status: 404 });
  }

  const totalAmount = Number(structure.amount);
  const installmentMonths = structure.installment_months ? Number(structure.installment_months) : null;

  const monthLabels: string[] = [];
  if (installmentMonths && installmentMonths > 0 && structure.created_at) {
    const startDate = new Date(structure.created_at);
    const startMonth = startDate.getUTCMonth();
    for (let i = 0; i < installmentMonths; i++) {
      const mi = (startMonth + i) % 12;
      monthLabels.push(MONTHS[mi]);
    }
  }

  const memberPayments = new Map<string, { amount: number; monthIndex: number }[]>();
  for (const p of payments ?? []) {
    if (!memberPayments.has(p.member_id)) memberPayments.set(p.member_id, []);
    let mi = -1;
    if (installmentMonths && p.paid_at) {
      const pd = new Date(p.paid_at);
      const pdMonth = pd.getUTCMonth();
      if (structure.created_at) {
        const startDate = new Date(structure.created_at);
        const startMonth = startDate.getUTCMonth();
        let diff = pdMonth - startMonth;
        if (diff < 0) diff += 12;
        if (diff < installmentMonths) mi = diff;
      }
    }
    memberPayments.get(p.member_id)!.push({ amount: Number(p.amount_paid), monthIndex: mi });
  }

  let rows: PaymentStatusRow[] = members.map((m) => {
    const mp = memberPayments.get(m.id) ?? [];
    const totalPaid = mp.reduce((s, p) => s + p.amount, 0);
    const monthlyPaid: number[] = installmentMonths ? new Array(installmentMonths).fill(0) : [];
    for (const p of mp) {
      if (p.monthIndex >= 0 && p.monthIndex < (installmentMonths ?? 0)) {
        monthlyPaid[p.monthIndex] += p.amount;
      }
    }
    return {
      memberName: formatNameLastFirst(m.full_name),
      totalAmount,
      totalPaid,
      remaining: totalAmount - totalPaid,
      monthlyPaid,
    };
  });
  rows.sort((a, b) => a.memberName.localeCompare(b.memberName));

  const allSettings = await getAllSettings();
  const pdf = buildPaymentStructurePdf({
    churchName: allSettings.church_name ?? "Church",
    structureName: structure.name,
    deadline: structure.deadline,
    generatedAt: new Date(),
    installmentMonths,
    monthLabels,
    rows,
  });

  const filename = `${structure.name.toLowerCase().replace(/\s+/g, "-")}-report.pdf`;

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
