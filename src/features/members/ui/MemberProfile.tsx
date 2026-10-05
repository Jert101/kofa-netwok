"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiResponse } from "@/lib/api/response";
import { formatPeso } from "@/lib/format-peso";
import { DEACTIVATION_REASON_MAX } from "@/features/members/deactivation";
import { DeactivateDialog } from "@/features/members/ui/DeactivateDialog";
import { MemberSheet } from "@/features/members/ui/MemberSheet";
import type { MemberRow } from "@/features/members/member-query";
import type { MemberStats } from "@/app/api/admin/members/[id]/stats/route";

export type MemberProfileProps = { memberId: string };

export function MemberProfile({ memberId }: MemberProfileProps) {
  const [member, setMember] = useState<MemberRow | null>(null);
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [loading, setLoading] = useState(true);
  /** The profile wipes only when the member cannot be read. */
  const [error, setError] = useState<string | null>(null);
  /** A stats failure (e.g. the Sundays toggle) must not take the dossier with it. */
  const [statsError, setStatsError] = useState<string | null>(null);
  const [sundaysOnly, setSundaysOnly] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [batches, setBatches] = useState<string[]>([]);

  const loadMember = useCallback(async () => {
    const res = await fetch(`/api/admin/members/${memberId}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body: unknown = await res.json().catch(() => null);
    if (!isApiResponse<{ member: MemberRow }>(body) || !body.ok) {
      setError(isApiResponse(body) && !body.ok ? body.error.message : "Could not load member.");
      return;
    }
    setMember(body.data.member);
  }, [memberId]);

  const loadStats = useCallback(async () => {
    const res = await fetch(
      `/api/admin/members/${memberId}/stats${sundaysOnly ? "?sundays=1" : ""}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    const body: unknown = await res.json().catch(() => null);
    if (!isApiResponse<MemberStats>(body) || !body.ok) {
      setStatsError(isApiResponse(body) && !body.ok ? body.error.message : "Could not load history.");
      return;
    }
    setStatsError(null);
    setStats(body.data);
  }, [memberId, sundaysOnly]);

  // Member and stats are independent. They used to live in one effect: toggling Sundays-only
  // re-ran loadMember, flapped the whole profile through the loading state, and a failed stats read
  // replaced the member's dossier with an error. Now the member loads once per id, and the stats
  // reload quietly in their own section.
  useEffect(() => {
    setLoading(true);
    setError(null);
    void loadMember().finally(() => setLoading(false));
  }, [loadMember]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/member-batches", { credentials: "same-origin" });
      const body: unknown = await res.json().catch(() => null);
      if (isApiResponse<{ batches?: { year: string }[] }>(body) && body.ok) {
        setBatches((body.data.batches ?? []).map((b) => b.year));
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/members">
            <ArrowLeft aria-hidden className="size-4" />
            Back to members
          </Link>
        </Button>
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error ?? "Member not found."}
        </p>
      </div>
    );
  }

  const { metrics } = stats ?? { metrics: null };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/admin/members">
              <ArrowLeft aria-hidden className="size-4" />
              Members
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{member.full_name}</h1>
            <Badge variant={member.is_active ? "default" : "secondary"}>
              {member.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden className="size-4" />
            Edit
          </Button>
          {member.is_active ? (
            <Button variant="outline" size="sm" onClick={() => setDeactivating(true)}>
              Deactivate…
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-xl border p-3 text-sm ${
            notice.tone === "error"
              ? "border-[var(--danger)] text-[var(--danger)]"
              : "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <section aria-labelledby="details-heading" className="space-y-3">
        <h2 id="details-heading" className="text-sm font-semibold text-[var(--text-muted)]">
          Details
        </h2>
        <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Date of birth" value={member.date_of_birth} />
          <Field label="Gender" value={member.gender ? capitalize(member.gender) : null} />
          <Field label="Contact number" value={member.contact_number} />
          <Field label="Batch" value={member.batch} />
          {!member.is_active ? (
            <>
              <Field
                label="Deactivated on"
                value={member.deactivated_at ? member.deactivated_at.slice(0, 10) : null}
              />
              <Field label="Reason" value={member.deactivation_reason} />
            </>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="attendance-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="attendance-heading" className="text-sm font-semibold text-[var(--text-muted)]">
            Attendance
          </h2>
          <div className="flex items-center gap-2">
            <Label htmlFor="sundays-only" className="text-sm font-normal">
              Sundays only
            </Label>
            <Switch
              id="sundays-only"
              checked={sundaysOnly}
              onCheckedChange={setSundaysOnly}
            />
          </div>
        </div>

        {statsError ? (
          <p role="alert" className="text-sm text-[var(--danger)]">{statsError}</p>
        ) : metrics === null ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Sessions served"
              value={String(metrics.lifetimeServed)}
              hint="All time, including archived reports"
            />
            <Stat
              label={sundaysOnly ? "Rate (Sundays, 3 months)" : "Rate (3 months)"}
              value={metrics.attendanceRate === null ? "—" : `${metrics.attendanceRate}%`}
              hint={
                metrics.sessionsHeld === 0
                  ? "No sessions held in this period"
                  : `of ${metrics.sessionsHeld} session${metrics.sessionsHeld === 1 ? "" : "s"} held`
              }
            />
            <Stat
              label="Weekend streak"
              value={String(metrics.weekendStreak)}
              hint={
                metrics.weekendStreak === 1
                  ? "consecutive weekend"
                  : "consecutive weekends"
              }
            />
            <Stat
              label="Last served"
              value={metrics.lastServedDate ?? "—"}
              hint={metrics.lastServedDate ? undefined : "No sessions recorded yet"}
            />
          </dl>
        )}
      </section>

      {stats && stats.recent.length > 0 ? (
        <section aria-labelledby="recent-heading" className="space-y-3">
          <h2 id="recent-heading" className="text-sm font-semibold text-[var(--text-muted)]">
            Recent sessions
          </h2>
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {stats.recent.map((s) => (
              <li key={`${s.id}-${s.sessionDate}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {s.massName ?? "Mass"}
                    {s.archived ? (
                      <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
                        (archived)
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {s.sessionDate}
                    {s.sunday ? " · Sunday" : ""}
                  </p>
                </div>
                <Badge variant={s.present ? "default" : "outline"}>
                  {s.present ? "Present" : "Absent"}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stats && stats.payments.length > 0 ? (
        <section aria-labelledby="payments-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="payments-heading" className="text-sm font-semibold text-[var(--text-muted)]">
              Payments
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/payments">Open the ledger</Link>
            </Button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th scope="col" className="px-4 py-2 font-medium">Structure</th>
                  <th scope="col" className="px-4 py-2 font-medium">Amount</th>
                  <th scope="col" className="px-4 py-2 font-medium">Paid</th>
                  <th scope="col" className="px-4 py-2 font-medium">Remaining</th>
                  <th scope="col" className="px-4 py-2 font-medium">Last paid</th>
                </tr>
              </thead>
              <tbody>
                {stats.payments.map((p) => (
                  <tr key={p.structureId} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-2.5">
                      {p.structureName}
                      {!p.isActive ? (
                        <span className="ml-1 text-xs text-[var(--text-muted)]">(closed)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{formatPeso(Number(p.amount))}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatPeso(Number(p.paid))}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {Number(p.remaining) > 0 ? (
                        <span className="text-[var(--danger)]">{formatPeso(Number(p.remaining))}</span>
                      ) : (
                        <span className="text-[var(--success)]">Settled</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)]">{p.lastPaidAt ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Read only. Record payments in the ledger.
          </p>
        </section>
      ) : null}

      <MemberSheet
        open={editing}
        member={member}
        batches={batches}
        busy={busy}
        error={actionError}
        onOpenChange={setEditing}
        onSubmit={(values) => {
          setActionError(null);
          setBusy(true);
          void (async () => {
            const res = await fetch(`/api/admin/members/${memberId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: "update", ...values }),
            });
            const body: unknown = await res.json().catch(() => null);
            setBusy(false);
            if (!isApiResponse(body) || !body.ok) {
              setActionError(
                isApiResponse(body) && !body.ok
                  ? (Object.values(body.error.fields ?? {})[0] ?? body.error.message)
                  : "Could not save.",
              );
              return;
            }
            setEditing(false);
            setNotice({ tone: "success", text: "Member updated." });
            await Promise.all([loadMember(), loadStats()]);
          })();
        }}
      />

      <DeactivateDialog
        open={deactivating}
        name={member.full_name}
        busy={busy}
        error={actionError}
        onOpenChange={setDeactivating}
        onConfirm={(reason, note) => {
          setActionError(null);
          setBusy(true);
          void (async () => {
            const res = await fetch(`/api/admin/members/${memberId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                action: "deactivate",
                reason,
                note: note ? note.slice(0, DEACTIVATION_REASON_MAX) : null,
              }),
            });
            const body: unknown = await res.json().catch(() => null);
            setBusy(false);
            if (!isApiResponse(body) || !body.ok) {
              setActionError(
                isApiResponse(body) && !body.ok ? body.error.message : "Could not deactivate.",
              );
              return;
            }
            setDeactivating(false);
            setNotice({ tone: "success", text: `${member.full_name} deactivated.` });
            await Promise.all([loadMember(), loadStats()]);
          })();
        }}
      />
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}
