"use client";

import PaymentLookup from "@/components/PaymentLookup";

export default function SecretaryPaymentsPage() {
  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-lg font-semibold">Payments</h1>
      <p className="text-sm text-[var(--muted)]">Search a member to view their payment status.</p>
      <PaymentLookup />
    </div>
  );
}
