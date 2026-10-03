import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireValidSession } from "@/lib/auth/require-valid-session";
import { getSetting } from "@/lib/settings/store";
import { churchToday, daysBetween } from "@/lib/time/church-time";

/**
 * DSH-5's home.
 *
 * A server component, and a real count. The old page fetched `/api/super-admin/reports?status=pending`
 * and used `.length` of the returned array, which is capped by whatever limit that route has -- so a
 * queue of fifty could display as three.
 */
export default async function SuperAdminDashboardPage() {
  await requireValidSession("super_admin");
  const asOf = churchToday(await getSetting("report_timezone"));

  const sb = getSupabaseAdmin();
  const { count } = await sb
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const { data: oldest } = await sb
    .from("reports")
    .select("created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const waitingDays = oldest?.created_at
    ? Math.max(0, daysBetween(String(oldest.created_at).slice(0, 10), asOf))
    : 0;

  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-lg font-semibold">Super Admin</h1>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-sm text-[var(--text-muted)]">Reports waiting for review</p>
        <p className="mt-2 text-3xl font-bold tabular-nums">{count ?? 0}</p>
        {count && count > 0 ? (
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Oldest has been waiting {waitingDays} {waitingDays === 1 ? "day" : "days"}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--text-muted)]">Nothing is waiting on you.</p>
        )}
        <Link
          href="/super-admin/reports"
          className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[var(--brand)] px-5 text-sm font-semibold text-white"
        >
          Review reports
        </Link>
      </div>
    </div>
  );
}