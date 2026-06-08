import Link from "next/link";

export default function TreasurerHomePage() {
  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-lg font-semibold">Treasurer Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/treasurer/payment-structures"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm"
        >
          <h2 className="font-semibold text-[var(--accent)]">Payment Structures</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Manage payment types, amounts, and deadlines</p>
        </Link>
        <Link
          href="/treasurer/payments"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm"
        >
          <h2 className="font-semibold text-[var(--accent)]">Payments</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Record member payments and view history</p>
        </Link>
      </div>
    </div>
  );
}
