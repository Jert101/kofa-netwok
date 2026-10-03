import { PaymentLookupPage } from "@/features/payments/PaymentLookupPage";
import { requireValidSession } from "@/lib/auth/require-valid-session";

/**
 * The member's own payment record.
 *
 * A server component so the member id comes from the session rather than from a search box: a member
 * typing a near-miss of their own name and being told they do not exist is a bad afternoon.
 */
export default async function MemberPaymentsPage() {
  const session = await requireValidSession("member");

  return (
    <PaymentLookupPage
      heading="My payments"
      description="Your payment record against each structure that applies to you."
      memberId={session.actor?.id ?? null}
      selfOnly
    />
  );
}