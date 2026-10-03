"use client";

/**
 * Creates a session for a date.
 *
 * Replaces the old create/edit form, which used the same component for both and
 * listed members to tick before saving. That tick-list was the wrong shape for
 * creating a session: the secretary would set up next Sunday's Mass by marking
 * people present before anyone had attended. Sessions now start empty and the roster
 * is encoded afterwards.
 *
 * The part worth noting is what happens when the session already exists. That is not
 * an error the secretary caused — the weekend cron may have created it, or they may
 * have double-tapped — so rather than showing a failure, this opens the existing
 * session and lets them get on with it.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { dataOf, fieldOf, messageOf, readEnvelope } from "@/lib/api/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Mass = {
  id: string;
  name: string;
  default_sunday: boolean;
  default_time: string | null;
  is_active: boolean;
};

export function AddSession({ sessionDate }: { sessionDate: string }) {
  const router = useRouter();
  const [masses, setMasses] = useState<Mass[]>([]);
  const [massId, setMassId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/masses", { credentials: "same-origin" });
        const body = (await res.json()) as { data?: { masses?: Mass[] } };
        if (cancelled) return;
        // Enveloped response: the array is under `data`. See admin/masses for why this is spelled out.
        const active = (body.data?.masses ?? []).filter((m) => m.is_active);
        setMasses(active);
        setMassId(active[0]?.id ?? "");
      } catch {
        if (!cancelled) setError("Could not load the Mass list.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (!massId) return;
    setError(null);
    setSaving(true);

    try {
      const res = await fetch("/api/attendance/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ session_date: sessionDate, mass_id: massId, member_ids: [] }),
      });

      const env = await readEnvelope<{ id: string }>(res);

      // Enveloped: the new session's id is under `data`. Reading it off the top level is undefined,
      // so a successful create fell through to the error branch and the secretary was told "Could
      // not create the session" for a session that really was written to the database. Retrying then
      // produced a second Mass for the same date, which is how the calendar filled up with sessions
      // nobody could open.
      const created = dataOf(env);
      if (res.ok && created?.id) {
        router.push("/secretary/session/" + created.id);
        return;
      }

      // Already there. Open it rather than making them find it on the calendar. The id rides along
      // in error.fields, not at the top level. Keyed off the field rather than the status code so a
      // session that already exists is still opened if the code ever changes.
      const existingId = fieldOf(env, "existing_session_id");
      if (existingId) {
        router.push("/secretary/session/" + existingId);
        return;
      }

      setError(messageOf(env, "Could not create the session."));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="add-session-mass" className="text-sm font-medium text-[var(--text-muted)]">
          Mass
        </label>
        <Select value={massId} onValueChange={setMassId} disabled={saving}>
          <SelectTrigger id="add-session-mass" className="mt-2 min-h-12 w-full">
            <SelectValue placeholder="Choose a Mass" />
          </SelectTrigger>
          <SelectContent>
            {masses.map((mass) => (
              <SelectItem key={mass.id} value={mass.id}>
                {mass.name}
                {mass.default_time ? ` — ${mass.default_time.slice(0, 5)}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {masses.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            No active Masses. An admin needs to add one first.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        onClick={() => void submit()}
        disabled={saving || !massId || masses.length === 0}
        className="min-h-14 w-full"
      >
        {saving ? "Creating…" : "Create session"}
      </Button>
    </div>
  );
}
