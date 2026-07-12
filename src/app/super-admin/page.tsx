"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/super-admin/reports?status=pending", { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as { reports?: unknown[] };
      setPendingCount((j.reports ?? []).length);
    })();
  }, []);

  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-lg font-semibold">Super Admin Dashboard</h1>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <p className="text-sm text-[var(--muted)]">Pending reports for review</p>
        <p className="mt-2 text-3xl font-bold text-[var(--text)]">{pendingCount ?? "…"}</p>
        <button
          type="button"
          onClick={() => router.push("/super-admin/reports")}
          className="mt-4 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white"
        >
          Review reports
        </button>
      </div>
    </div>
  );
}