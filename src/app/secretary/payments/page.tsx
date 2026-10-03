import { PaymentLookupPage } from "@/features/payments/PaymentLookupPage";

export default function SecretaryPaymentsPage() {
  return (
    <PaymentLookupPage
      heading="Payments"
      description="Search a member to see whether they are paid up. Amounts are kept by the treasurer."
    />
  );
}