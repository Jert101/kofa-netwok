"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LiturgyPlanner } from "@/features/liturgy/ui/LiturgyPlanner";
import type { LiturgyRow } from "@/lib/liturgy/rules";

function formatLongDate(ymd: string): string {
  try {
    return format(parseISO(ymd), "MMMM d yyyy");
  } catch {
    return ymd;
  }
}

export default function OfficerPlanMassPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  const massId = String(params.massId ?? "");
  const router = useRouter();
  const [massName, setMassName] = useState("");
  const [rows, setRows] = useState<Array<LiturgyRow & { member_name?: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  // Only the heading comes from here. The editor loads its own rows through `/api/liturgy/planned`,
  // so there is one code path that knows how to read and write a plan rather than two that can
  // disagree about the shape of it.

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/attendance/liturgy-planned?date=${encodeURIComponent(date)}&mass_id=${encodeURIComponent(massId)}`,
      { credentials: "same-origin" }
    );
    if (!res.ok) {
      router.replace(`/officer/day/${date}`);
      return;
    }
    const j = (await res.json()) as {
      mass_name: string;
      slots: Array<LiturgyRow & { member_name?: string | null }>;
    };
    setMassName(j.mass_name);
    setRows(j.slots ?? []);
    setLoading(false);
  }, [date, massId, router]);

  useEffect(() => {
    void load();
  }, [load, version]);

  return (
    <div>
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-3 min-h-11 text-sm font-medium text-[var(--brand)]"
      >
        ← Back
      </button>
      <h1 className="text-lg font-semibold">{loading ? "…" : massName}</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{formatLongDate(date)}</p>

      {!loading ? (
        <div className="mt-4">
          <LiturgyPlanner
            target={{ kind: "planned", sessionDate: date, massId }}
            title="Plan this Mass"
            subtitle={formatLongDate(date)}
            initialRows={rows}
            onSaved={() => setVersion((v) => v + 1)}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--text-muted)]">Loading…</p>
      )}
    </div>
  );
}
