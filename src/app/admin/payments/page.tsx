import { PaymentLookupPage } from "@/features/payments/PaymentLookupPage";

export default function AdminPaymentsPage() {
  return (
    <PaymentLookupPage
      heading="Payments"
      description="Search a member to see their payment record. Amounts are visible to you as admin."
    />
  );
}