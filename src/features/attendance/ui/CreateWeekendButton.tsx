"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { dataOf, messageOf, readEnvelope } from "@/lib/api/client";

/**
 * ATT-2 manual button: "Create this weekend's sessions".
 *
 * The weekly cron usually gets there first. This exists for the parishes where it did
 * not — the setting is off, the cron was added late, or the Mass list changed on
 * Saturday morning. It reports what happened rather than a bare "done", because "I
 * created three" and "they already existed" are both success and only one of them
 * means the secretary should go and check something.
 */
export function CreateWeekendButton() {
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; text?: string }>({
    kind: "idle",
  });

  async function run() {
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/attendance/sessions/weekend", {
        method: "POST",
        credentials: "same-origin",
      });
      const env = await readEnvelope<{
        sunday?: string;
        created?: { mass_name: string }[];
        skipped?: string[];
        reason?: string | null;
      }>(res);

      if (!res.ok) {
        setState({ kind: "error", text: messageOf(env, "Could not create the sessions.") });
        return;
      }

      // Enveloped: the report lives under `data`. Read off the top level every field was undefined,
      // so this button created the sessions and then announced "Created 0 sessions for undefined" --
      // which reads as a failure and invites a pointless retry.
      const body = dataOf(env) ?? {};
      const created = body.created?.length ?? 0;
      const skipped = body.skipped?.length ?? 0;

      if (body?.reason === "no_default_sunday_masses") {
        setState({ kind: "error", text: "No Mass is set as a Sunday Mass. An admin can set that up." });
        return;
      }
      if (body?.reason) {
        // The month is closed. That is an answer, not a failure.
        setState({ kind: "done", text: body.reason });
        return;
      }
      if (created && skipped) {
        setState({
          kind: "done",
          text: `Created ${created} for ${body.sunday}. ${skipped} already existed.`,
        });
        return;
      }
      if (skipped) {
        setState({ kind: "done", text: `Already set up for ${body.sunday}.` });
        return;
      }

      setState({ kind: "done", text: `Created ${created} session${created === 1 ? "" : "s"} for ${body.sunday}.` });
    } catch {
      setState({ kind: "error", text: "Could not reach the server." });
    }
  }

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        disabled={state.kind === "busy"}
        onClick={() => void run()}
      >
        {state.kind === "busy" ? "Creating…" : "Create this weekend's sessions"}
      </Button>
      {state.text ? (
        <p
          className={`mt-2 text-sm ${state.kind === "error" ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}
          role="status"
        >
          {state.text}
        </p>
      ) : null}
    </div>
  );
}
