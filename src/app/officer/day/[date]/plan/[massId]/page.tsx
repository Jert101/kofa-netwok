"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LiturgyPlanner } from "@/features/liturgy/ui/LiturgyPlanner";

function formatLongDate(ymd: string): string {
  try {
    return format(parseISO(ymd), "MMMM d yyyy");
  } catch {
    return ymd;
  }
}

/**
 * Plan one Mass.
 *
 * The page used to fetch the rows itself through `/api/attendance/liturgy-planned` and hand them
 * to the editor as `initialRows`, while the editor would have fetched the same plan through
 * `/api/liturgy/planned` if it had not been given rows. Two read paths that spelled the payload
 * differently (`slots` here, `rows` there) is the version of "two sources of truth" this screen had.
 * The version it handed over was `null`, so the save-level "Updated by another device" notice could
 * never fire either.
 *
 * Now the editor is the one reader: it fetches `/api/liturgy/planned`, so it starts with the rows and
 * the version together. The only thing this page still asks for is the Mass name, because that is the
 * heading and the editor's own title already covers the rest.
 */
export default function OfficerPlanMassPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  const massId = String(params.massId ?? "");
  const router = useRouter();
  const [massName, setMassName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/attendance/liturgy-planned?date=${encodeURIComponent(date)}&mass_id=${encodeURIComponent(massId)}`,
      { credentials: "same-origin" },
    );
    if (!res.ok) {
      // Do not redirect away from the plan. The Mass-name fetch is a courtesy for the heading; if it
      // fails, the editor must still render, because a redirect here is exactly how the officer lost
      // the ability to assign servers in the "it's gone" report.
      setMassName(null);
      return;
    }
    const j = (await res.json()) as { mass_name?: string };
    setMassName(j.mass_name ?? null);
  }, [date, massId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-3 min-h-11 text-sm font-medium text-[var(--brand)]"
      >
        ← Back
      </button>
      <h1 className="text-lg font-semibold">{massName ?? "…"}</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{formatLongDate(date)}</p>

      <div className="mt-4">
        <LiturgyPlanner
          target={{ kind: "planned", sessionDate: date, massId }}
          title="Plan this Mass"
          subtitle={formatLongDate(date)}
        />
      </div>
    </div>
  );
}