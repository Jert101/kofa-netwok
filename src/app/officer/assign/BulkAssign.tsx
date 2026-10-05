"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { datesInRange, drawSlots, type BulkMember, type BulkSlot } from "@/lib/liturgy/bulk-assign";
import type { GenderRule, TemplatePosition } from "@/lib/liturgy/rules";

type Mass = { id: string; name: string };
type Slot = BulkSlot;

type Preview = {
  toFill: number;
  alreadyAssigned: { date: string; mass: string; count: number }[];
};

/**
 * Assign across a whole date range and several Masses at once.
 *
 * What is shared and what varies comes from the template: the template supplies the positions and each
 * position's gender rule, and those travel to every date, while the servers are drawn fresh per date.
 * Copying one fixed roster across every Sunday would book the same people every week, which is not what
 * "plan the next month" means.
 *
 * Anything already assigned is never silently replaced: the preview lists it, and the officer either
 * leaves it alone or ticks "replace" to rebuild those dates from the template.
 */
export function BulkAssign({
  masses,
  sendPush,
}: {
  masses: Mass[];
  sendPush: boolean;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [positions, setPositions] = useState<TemplatePosition[] | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/officer/liturgy-templates", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { templates?: Array<{ id: string; name: string }> };
        setTemplates(body.templates ?? []);
      } catch {
        setTemplates([]);
      }
    })();
  }, []);

  const loadTemplatePositions = useCallback(async (id: string) => {
    if (!id) {
      setPositions(null);
      return;
    }
    try {
      const res = await fetch(`/api/officer/liturgy-templates/${encodeURIComponent(id)}`, {
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => ({}))) as {
        positions?: TemplatePosition[];
        position_labels?: string[];
      };
      if (!res.ok) return;
      setPositions(
        body.positions ??
          (body.position_labels ?? []).map((position_label) => ({ position_label, required_gender: "any" as GenderRule })),
      );
    } catch {
      setPositions(null);
    }
  }, []);

  const toggleMass = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  const dates = start && end && start <= end ? datesInRange(start, end) : [];

  /** What is already there, so nothing is overwritten without the officer saying so. */
  const runPreview = async () => {
    setError(null);
    setResult(null);
    if (dates.length === 0) {
      setError("Pick a start and end date.");
      return;
    }
    if (selected.length === 0) {
      setError("Pick at least one Mass.");
      return;
    }
    if (!positions || positions.length === 0) {
      setError("Pick a template first -- it supplies the positions and their rules.");
      return;
    }
    try {
      const res = await fetch(
        `/api/attendance/liturgy-summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&allow_past=1`,
        { credentials: "same-origin" },
      );
      if (!res.ok) throw new Error();
      const body = (await res.json()) as {
        days?: Array<{
          date: string;
          masses?: Array<{ mass_id: string; mass_name: string; slots?: unknown[] }>;
        }>;
      };
      const existing = new Map<string, { mass: string; count: number }>();
      for (const day of body.days ?? []) {
        for (const m of day.masses ?? []) {
          const count = m.slots?.length ?? 0;
          if (count > 0) existing.set(`${day.date}|${m.mass_id}`, { mass: m.mass_name, count });
        }
      }
      const alreadyAssigned: Preview["alreadyAssigned"] = [];
      let toFill = 0;
      for (const date of dates) {
        for (const massId of selected) {
          const hit = existing.get(`${date}|${massId}`);
          if (hit) {
            alreadyAssigned.push({ date, mass: hit.mass, count: hit.count });
          } else {
            toFill += 1;
          }
        }
      }
      setPreview({ toFill, alreadyAssigned });
    } catch {
      setError("Could not read what is already assigned in that range.");
    }
  };

  const apply = async () => {
    if (!positions) return;
    setBusy(true);
    setError(null);
    setResult(null);

    let members: BulkMember[];
    try {
      const res = await fetch("/api/admin/members?status=active&page_size=100", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as {
        data?: { members?: Array<{ id: string; full_name: string; gender?: string | null }> };
      };
      members = (body.data?.members ?? []).map((m) => ({
        id: String(m.id),
        full_name: String(m.full_name ?? ""),
        gender: m.gender ?? null,
      }));
    } catch {
      setBusy(false);
      setError("Could not load the member list, so nothing was assigned.");
      return;
    }

    let filled = 0;
    let skipped = 0;
    let unfilledTotal = 0;
    const failures: string[] = [];

    for (const date of dates) {
      // One set for the whole day, so the same person cannot be drawn for two Masses on that date.
      const usedThisDate = new Set<string>();
      for (const massId of selected) {
        setProgress(`Assigning ${date}…`);
        try {
          const existingRes = await fetch(
            `/api/attendance/liturgy-planned?date=${encodeURIComponent(date)}&mass_id=${encodeURIComponent(massId)}`,
            { credentials: "same-origin" },
          );
          const existingBody = existingRes.ok
            ? ((await existingRes.json()) as { slots?: Slot[] })
            : { slots: [] };
          const existing = existingBody.slots ?? [];
          for (const s of existing) if (s.member_id) usedThisDate.add(s.member_id);

          if (existing.length > 0 && !replaceExisting) {
            skipped += 1;
            continue;
          }

          const { slots, unfilled } = drawSlots(positions, members, usedThisDate, Math.random);
          unfilledTotal += unfilled;
          if (slots.length === 0) {
            failures.push(`${date} (${massId}): no eligible server for any position.`);
            continue;
          }

          const put = await fetch("/api/attendance/liturgy-planned", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_date: date, mass_id: massId, slots, send_push: sendPush }),
          });
          if (!put.ok) {
            failures.push(`${date}: the server refused that date.`);
            continue;
          }
          filled += 1;
        } catch {
          failures.push(`${date}: could not be reached.`);
        }
      }
    }

    setBusy(false);
    setProgress(null);
    setResult(
      [
        `Filled ${filled} date${filled === 1 ? "" : "s"}${selected.length > 1 ? "×Mass slot" : ""}.`,
        skipped > 0 ? `Left ${skipped} alone because servers were already assigned.` : "",
        unfilledTotal > 0
          ? `${unfilledTotal} position${unfilledTotal === 1 ? " had" : "s had"} no eligible member and ${unfilledTotal === 1 ? "was" : "were"} left open.`
          : "",
        failures.length > 0 ? `Problems: ${failures.slice(0, 3).join(" ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    await runPreview();
  };

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-medium">Assign across a date range</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        A template supplies the positions and each position&apos;s rule; servers are drawn fresh for
        every date, so nobody is booked the same every week and nobody serves two Masses on one day.
      </p>

      {templates.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          You have no templates yet. Create one on the Templates page to use this.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs text-[var(--text-muted)]">From</span>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-muted)]">To</span>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-muted)]">Template</span>
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  void loadTemplatePositions(e.target.value);
                }}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              >
                <option value="">Choose a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="text-xs text-[var(--text-muted)]">Masses</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {masses.map((m) => (
                <label
                  key={m.id}
                  className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(m.id)}
                    onChange={() => toggleMass(m.id)}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>

          {positions ? (
            <p className="text-xs text-[var(--text-muted)]">
              {positions.length} position{positions.length === 1 ? "" : "s"} from the template:{" "}
              {positions.map((p) => `${p.position_label}${p.required_gender === "any" ? "" : ` (${p.required_gender})`}`).join(", ")}.
            </p>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
            />
            <span>Replace dates that already have servers (leave unticked to skip them)</span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void runPreview()}>
              Check what would change
            </Button>
            <Button size="sm" onClick={() => void apply()} disabled={busy || !positions}>
              {busy ? "Assigning…" : "Assign the range"}
            </Button>
          </div>

          {progress ? <p className="text-sm text-[var(--text-muted)]">{progress}</p> : null}

          {preview ? (
            <div className="rounded-xl border border-[var(--border)] p-3 text-sm">
              <p>
                Will fill <span className="font-semibold">{preview.toFill}</span> date
                {preview.toFill === 1 ? "" : "s"}.
              </p>
              {preview.alreadyAssigned.length > 0 ? (
                <p className="mt-1 text-[var(--text-muted)]">
                  {preview.alreadyAssigned.length} already have servers and will be{" "}
                  {replaceExisting ? "replaced" : "left alone"}:{" "}
                  {preview.alreadyAssigned
                    .slice(0, 5)
                    .map((a) => `${a.date} ${a.mass}`)
                    .join(", ")}
                  {preview.alreadyAssigned.length > 5 ? ", …" : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {result ? <p role="status" className="text-sm text-[var(--text-muted)]">{result}</p> : null}
          {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
        </div>
      )}
    </section>
  );
}