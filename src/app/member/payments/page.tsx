"use client";

import PaymentLookup from "@/components/PaymentLookup";

export default function MemberPaymentsPage() {
  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-lg font-semibold">My Payments</h1>
      <p className="text-sm text-[var(--muted)]">Search your name to view your payment status.</p>
      <PaymentLookup />
    </div>
  );
}
