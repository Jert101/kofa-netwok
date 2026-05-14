"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LiturgyServerEditor, type LiturgyRow } from "@/components/LiturgyServerEditor";

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
  const [rows, setRows] = useState<LiturgyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

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
      slots: Array<{ position_label: string; member_id: string | null; member_name: string | null; free_text: string | null }>;
    };
    setMassName(j.mass_name);
    setRows(
      (j.slots ?? []).map((s) => ({
        position_label: s.position_label,
        member_id: s.member_id,
        member_name: s.member_name,
        free_text: s.free_text,
      }))
    );
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
        className="mb-3 min-h-11 text-sm font-medium text-[var(--accent)]"
      >
        ← Back
      </button>
      <h1 className="text-lg font-semibold">{loading ? "…" : massName}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">{formatLongDate(date)}</p>

      {!loading ? (
        <LiturgyServerEditor
          mode="planned"
          sessionDate={date}
          massId={massId}
          massName={massName}
          initialRows={rows}
          onSaved={() => setVersion((v) => v + 1)}
        />
      ) : (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>
      )}
    </div>
  );
}
