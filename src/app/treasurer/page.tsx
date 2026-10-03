import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireValidSession } from "@/lib/auth/require-valid-session";
import { getSetting } from "@/lib/settings/store";
import { fetchTreasurerSummary } from "@/lib/payments/server/ledger";
import { formatPeso } from "@/lib/format-peso";
import { churchToday } from "@/lib/time/church-time";
import { churchTodayLabel } from "@/lib/time/church-time-labels";

/**
 * PAY-5: the treasurer's home.
 *
 * A server component on purpose. This page reads the summary and needs no interactivity beyond links,
 * and the old version was a client component that fetched two numbers it then threw away in favour of
 * two static links.
 *
 * Every figure comes from `fetchTreasurerSummary`, the same function the ledger and the overdue list
 * use, so the card and the page it links to cannot disagree.
 */
export default async function TreasurerHomePage() {
  // The layout already checked the session; this re-reads it for the role, which is a cached cookie
  // read rather than a query.
  await requireValidSession("treasurer");

  const asOf = churchToday(await getSetting("report_timezone"));

  let summary: Awaited<ReturnType<typeof fetchTreasurerSummary>> | null = null;
  try {
    summary = await fetchTreasurerSummary(asOf);
  } catch (e) {
    console.error("[treasurer home] summary failed:", e instanceof Error ? e.message : e);
  }

  const sb = getSupabaseAdmin();
  const { count: memberCount } = await sb
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-lg font-semibold">Treasurer</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">As of {churchTodayLabel(asOf)}.</p>
      </div>

      {summary ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <dt className="text-sm text-[var(--text-muted)]">Collected this month</dt>
            <dd className="mt-1 text-2xl font-semibold">{formatPeso(summary.collectedThisMonth)}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <dt className="text-sm text-[var(--text-muted)]">Outstanding</dt>
            <dd className="mt-1 text-2xl font-semibold">{formatPeso(summary.outstandingTotal)}</dd>
          </div>
          <Link
            href="/treasurer/overdue"
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--surface-2)]"
          >
            <dt className="text-sm text-[var(--text-muted)]">Members behind</dt>
            <dd className="mt-1 text-2xl font-semibold">{summary.overdueCount}</dd>
          </Link>
        </dl>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
          Could not load the payments summary. The pages below still work.
        </div>
      )}

      <section aria-labelledby="structures-heading">
        <h2 id="structures-heading" className="text-sm font-semibold text-[var(--brand)]">
          Per structure
        </h2>

        {summary && summary.byStructure.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Collected and outstanding per payment structure</caption>
              <thead>
                <tr className="text-[var(--text-muted)]">
                  <th scope="col" className="py-2 pr-3 font-medium">Structure</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Collected</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Outstanding</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Paid up</th>
                  <th scope="col" className="py-2 text-right font-medium">Members</th>
                </tr>
              </thead>
              <tbody>
                {summary.byStructure.map((row) => (
                  <tr key={row.structureId} className="border-t border-[var(--border)]">
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {row.structureName}
                      {!row.isActive ? (
                        <span className="ml-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                          inactive
                        </span>
                      ) : null}
                    </th>
                    <td className="py-2 pr-3 text-right">{formatPeso(row.collected)}</td>
                    <td className="py-2 pr-3 text-right font-medium">
                      {row.outstanding > 0 ? formatPeso(row.outstanding) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {row.memberCount > 0 ? `${row.paidCount} of ${row.memberCount}` : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/treasurer/overdue?structure_id=${encodeURIComponent(row.structureId)}`}
                        className="underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]">
            No payment structures yet. Create one to start recording dues.
          </p>
        )}
      </section>

      <nav className="flex flex-wrap gap-3">
        <Link
          href="/treasurer/payments"
          className="min-h-12 rounded-xl bg-[var(--brand)] px-5 font-medium leading-[3rem] text-white"
        >
          Record a payment
        </Link>
        <Link
          href="/treasurer/payment-structures"
          className="min-h-12 rounded-xl border border-[var(--border)] px-5 font-medium leading-[3rem]"
        >
          Payment structures
        </Link>
        <Link
          href="/treasurer/overdue"
          className="min-h-12 rounded-xl border border-[var(--border)] px-5 font-medium leading-[3rem]"
        >
          Overdue list
        </Link>
        <Link
          href="/treasurer/payments/csv"
          className="min-h-12 rounded-xl border border-[var(--border)] px-5 font-medium leading-[3rem]"
        >
          Export CSV
        </Link>
      </nav>

      <p className="text-sm text-[var(--text-muted)]">
        {memberCount ?? 0} active members on the roll.
      </p>
    </div>
  );
}