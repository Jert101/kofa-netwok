"use client";

import { addDays, format, parseISO } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LiturgyPlanner } from "@/features/liturgy/ui/LiturgyPlanner";

type Slot = { position_label: string; member_name: string | null; free_text: string | null };
type MassDay = { mass_id: string; mass_name: string; session_id: string | null; slots: Slot[] };
type DayBlock = { date: string; masses: MassDay[] };

function formatDayHeading(ymd: string): string {
  try {
    return format(parseISO(ymd), "MMMM d yyyy");
  } catch {
    return ymd;
  }
}

function groupedLines(slots: Slot[]): { position: string; names: string[] }[] {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const s of slots) {
    const pos = s.position_label;
    if (!map.has(pos)) {
      order.push(pos);
      map.set(pos, []);
    }
    const parts = [s.member_name, s.free_text].filter(Boolean) as string[];
    for (const p of parts) {
      const arr = map.get(pos)!;
      if (!arr.includes(p)) arr.push(p);
    }
  }
  return order.map((position) => ({ position, names: map.get(position) ?? [] }));
}

/**
 * Inline editor for one Mass on the officer's day view.
 *
 * The panel holds no rows of its own. It used to fetch `/api/attendance/*` and hand the rows to the
 * editor, which meant this component and the editor each knew half of how to read a plan. The
 * editor now loads and saves through `/api/liturgy/*` on its own, so all that is left here is which
 * target to point it at and when to refresh the summary underneath it.
 */
function OfficerMassEditorPanel({
  date,
  mass,
  onClose,
  onSaved,
}: {
  date: string;
  mass: MassDay;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <div className="mb-2 flex justify-end">
        <button type="button" className="text-sm text-[var(--text-muted)] underline" onClick={onClose}>
          Close editor
        </button>
      </div>
      <LiturgyPlanner
        target={
          mass.session_id
            ? { kind: "session", sessionId: mass.session_id }
            : { kind: "planned", sessionDate: date, massId: mass.mass_id }
        }
        title={mass.mass_name}
        subtitle={formatDayHeading(date)}
        onSaved={onSaved}
      />
    </div>
  );
}

export function AssignedServersSection({
  title = "Assigned servers (High Mass)",
  daysAhead = 14,
  memberBasePath = "/member/day",
  singleDate,
  officerEditable = false,
}: {
  title?: string;
  daysAhead?: number;
  memberBasePath?: string;
  singleDate?: string;
  /** Inline edit (planned or session) — use on officer day view with `singleDate` set. */
  officerEditable?: boolean;
}) {
  const [days, setDays] = useState<DayBlock[] | null>(null);
  const [tick, setTick] = useState(0);
  const [editingMassId, setEditingMassId] = useState<string | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const start = singleDate ?? format(new Date(), "yyyy-MM-dd");
    const end = singleDate ?? format(addDays(new Date(), daysAhead), "yyyy-MM-dd");
    const allowPast = singleDate ? "1" : "0";
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/attendance/liturgy-summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&allow_past=${allowPast}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) {
        if (!cancelled) setDays([]);
        return;
      }
      const j = (await res.json()) as { days?: DayBlock[] };
      if (!cancelled) setDays(j.days ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [daysAhead, singleDate, tick]);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--brand)]">{title}</h2>

      {days === null ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">Loading…</p>
      ) : days.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">No server assignments in this range yet.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {days.map((d) => (
            <li key={d.date} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`${memberBasePath}/${d.date}`}
                  className="text-sm font-semibold text-[var(--brand)] hover:underline"
                >
                  {formatDayHeading(d.date)}
                </Link>
              </div>
              <ul className="mt-2 space-y-3">
                {d.masses.map((m) => (
                  <li key={m.mass_id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text)]">{m.mass_name}</p>
                      {officerEditable && singleDate ? (
                        <button
                          type="button"
                          className="text-sm font-medium text-[var(--brand)]"
                          onClick={() => setEditingMassId((id) => (id === m.mass_id ? null : m.mass_id))}
                        >
                          {editingMassId === m.mass_id ? "Close edit" : "Edit"}
                        </button>
                      ) : null}
                    </div>
                    <ul className="mt-1 space-y-1 pl-0">
                      {groupedLines(m.slots).map((g) => (
                        <li key={g.position} className="text-sm text-[var(--text-muted)]">
                          <span className="font-medium text-[var(--text)]">{g.position}:</span>{" "}
                          {g.names.length ? g.names.join(", ") : "—"}
                        </li>
                      ))}
                    </ul>
                    {officerEditable && singleDate && editingMassId === m.mass_id ? (
                      <OfficerMassEditorPanel
                        date={singleDate}
                        mass={m}
                        onClose={() => setEditingMassId(null)}
                        onSaved={() => {
                          refresh();
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
