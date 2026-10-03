import { PaymentLookupPage } from "@/features/payments/PaymentLookupPage";

export default function OfficerPaymentsPage() {
  return (
    <PaymentLookupPage
      heading="Payments"
      description="Search a member to see whether they are paid up. Amounts are kept by the treasurer."
    />
  );
}