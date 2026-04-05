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

export default function OfficerSessionPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const router = useRouter();
  const [massName, setMassName] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [liturgy, setLiturgy] = useState<LiturgyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/attendance/session/${id}`, { credentials: "same-origin" });
    if (!res.ok) {
      router.replace("/officer");
      return;
    }
    const j = (await res.json()) as {
      session: { mass_name: string; session_date: string };
      liturgy_servers: LiturgyRow[];
    };
    setMassName(j.session.mass_name);
    setSessionDate(String(j.session.session_date));
    setLiturgy(
      (j.liturgy_servers ?? []).map((r) => ({
        position_label: r.position_label,
        member_id: r.member_id,
        member_name: r.member_name,
        free_text: r.free_text,
      }))
    );
    setLoading(false);
  }, [id, router]);

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
      <p className="mt-1 text-sm text-[var(--muted)]">{formatLongDate(sessionDate)}</p>

      {!loading ? (
        <LiturgyServerEditor
          mode="session"
          sessionId={id}
          initialRows={liturgy}
          onSaved={() => setVersion((v) => v + 1)}
        />
      ) : (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>
      )}
    </div>
  );
}
