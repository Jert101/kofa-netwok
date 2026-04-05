"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { OfficerCreateMassForm } from "@/components/OfficerCreateMassForm";

type SessionRow = { id: string; mass_id: string; mass_name: string; server_count: number };
type MassRow = { id: string; name: string };

function formatLongDate(ymd: string): string {
  try {
    return format(parseISO(ymd), "MMMM d yyyy");
  } catch {
    return ymd;
  }
}

export default function OfficerDayPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [masses, setMasses] = useState<MassRow[] | null>(null);
  const [selectedMassId, setSelectedMassId] = useState("");
  const [refresh, setRefresh] = useState(0);

  const reload = useCallback(async () => {
    const [dayRes, massRes] = await Promise.all([
      fetch(`/api/attendance/by-day?date=${encodeURIComponent(date)}`, { credentials: "same-origin" }),
      fetch("/api/masses", { credentials: "same-origin" }),
    ]);
    if (!dayRes.ok) {
      router.replace("/officer");
      return;
    }
    const dayJ = (await dayRes.json()) as { sessions: SessionRow[] };
    setSessions(dayJ.sessions);
    if (massRes.ok) {
      const mJ = (await massRes.json()) as { masses?: MassRow[] };
      setMasses(mJ.masses ?? []);
    } else {
      setMasses([]);
    }
  }, [date, router]);

  useEffect(() => {
    void reload();
  }, [reload, refresh]);

  const sessionByMassId = new Map<string, SessionRow>();
  for (const s of sessions ?? []) {
    sessionByMassId.set(s.mass_id, s);
  }

  useEffect(() => {
    const list = masses ?? [];
    if (!list.length) {
      setSelectedMassId("");
      return;
    }
    setSelectedMassId((cur) => (cur && list.some((m) => m.id === cur) ? cur : list[0].id));
  }, [masses]);

  function openSelectedMass() {
    const list = masses ?? [];
    const m = list.find((x) => x.id === selectedMassId);
    if (!m) return;
    const sess = sessionByMassId.get(m.id);
    router.push(sess ? `/officer/day/${date}/session/${sess.id}` : `/officer/day/${date}/plan/${m.id}`);
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="min-h-11 text-sm font-medium text-[var(--accent)]"
      >
        ← Back
      </button>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Assign servers</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{formatLongDate(date)}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Pick a mass, then add roles and members from the directory.</p>
        </div>
        <label className="flex flex-col text-xs text-[var(--muted)]">
          Date
          <input
            type="date"
            className="mt-1 min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
            value={date}
            onChange={(e) => {
              const v = e.target.value;
              if (v) router.push(`/officer/day/${v}`);
            }}
          />
        </label>
      </div>

      {sessions === null || masses === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : masses.length === 0 ? (
        <>
          <OfficerCreateMassForm onCreated={() => setRefresh((x) => x + 1)} />
          <AssignedServersSection
            title="This date — assigned servers"
            singleDate={date}
            memberBasePath="/officer/day"
            officerEditable
          />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col text-xs text-[var(--muted)]">
              Mass
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
                value={selectedMassId}
                onChange={(e) => setSelectedMassId(e.target.value)}
              >
                {masses.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {sessionByMassId.has(m.id) ? " · attendance open" : " · plan ahead"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-xl bg-[var(--accent)] px-5 text-sm font-medium text-white"
              onClick={() => openSelectedMass()}
            >
              Open
            </button>
          </div>

          <details className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
            <summary className="cursor-pointer p-3 text-sm font-medium text-[var(--text)]">Add another mass</summary>
            <div className="border-t border-[var(--border)] p-3">
              <OfficerCreateMassForm onCreated={() => setRefresh((x) => x + 1)} />
            </div>
          </details>

          <AssignedServersSection
            title="This date — assigned servers"
            singleDate={date}
            memberBasePath="/officer/day"
            officerEditable
          />
        </>
      )}
    </div>
  );
}
