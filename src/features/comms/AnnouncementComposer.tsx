"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AUDIENCE_ROLES,
  BODY_MAX,
  DEFAULT_EXPIRY,
  MAX_PINNED,
  TITLE_MAX,
  type ExpiryPreset,
} from "@/lib/announcements/audience";

type Props = {
  /** Used for the confirmations and the audit-free part of the flow. */
  onPosted?: () => void;
};

/**
 * COM-1: the announcement sheet.
 *
 * Every field the spec lists is here: title, body, audience, expiry, pin, send push. The defaults
 * are opinionated on purpose — a month, everyone, pushed, unpinned — because the common case is an
 * officer telling the parish something for the next month and the composer should be three taps,
 * not a form to learn.
 */
export function AnnouncementComposer({ onPosted }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [batches, setBatches] = useState<string[]>([]);
  const [batchInput, setBatchInput] = useState("");
  const [knownBatches, setKnownBatches] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryPreset>(DEFAULT_EXPIRY);
  const [customExpiry, setCustomExpiry] = useState("");
  const [pinned, setPinned] = useState(false);
  const [sendPush, setSendPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Batches are free text in the members table, so the composer suggests the years it has seen and
  // accepts a year it has not. Inventing a closed list would silently refuse a legitimate audience.
  useEffect(() => {
    void (async () => {
      try {
        // /api/admin/member-batches is admin/treasurer only. The public batch list is what the
        // registration form uses, and the composer's suggestions are exactly the same years.
        const res = await fetch("/api/public/batches", { credentials: "same-origin" });
        if (!res.ok) return;
        const j = (await res.json()) as { data?: { batches?: string[] } };
        // Enveloped response: `batches` sits under `data`. See admin/masses for why this is spelled out.
        const years = (j.data?.batches ?? []).map(String).filter(Boolean);
        if (years.length > 0) setKnownBatches(years.sort());
      } catch {
        // Suggestions are a convenience. Failing to load them must not break the composer.
      }
    })();
  }, []);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    const chosenBatches = batches.map((b) => b.trim()).filter(Boolean);
    if (expiry === "custom" && !customExpiry) {
      setError("Pick a date, or choose another expiry.");
      return;
    }
    if (roles.length === 0 && chosenBatches.length === 0) {
      // Allowed, but worth saying out loud: this is the difference between the whole parish
      // hearing it and nobody.
      if (!window.confirm(`No audience selected, so this goes to everyone in the parish. Post it?`)) {
        return;
      }
    }

    const deleteAt = expiryForLocal(expiry, customExpiry);

    setBusy(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          audience_roles: roles,
          audience_batches: chosenBatches,
          delete_at: deleteAt,
          pinned,
          send_push: sendPush,
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? "Could not post the announcement.");
        return;
      }
      setTitle("");
      setBody("");
      setRoles([]);
      setBatches([]);
      setPinned(false);
      setExpiry(DEFAULT_EXPIRY);
      setOk("Announcement posted.");
      onPosted?.();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="New announcement">
      <label className="block">
        <span className="text-sm font-medium text-[var(--text)]">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX}
          required
          className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
          placeholder="Collection times have changed"
        />
        <span className="mt-1 block text-xs text-[var(--text-muted)]">
          {title.length}/{TITLE_MAX}
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-[var(--text)]">Details</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={BODY_MAX}
          required
          rows={5}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          placeholder="Plain text. Line breaks are kept."
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-[var(--text)]">Audience</legend>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Choosing nothing means everyone. Roles and batches are a union: anyone who matches either
          sees it.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {AUDIENCE_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggle(roles, setRoles, r)}
              aria-pressed={roles.includes(r)}
              className={
                "min-h-10 rounded-full border px-3 text-sm capitalize " +
                (roles.includes(r)
                  ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                  : "border-[var(--border)] bg-[var(--surface)]")
              }
            >
              {r.replace("_", " ")}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <span className="text-sm text-[var(--text-muted)]">Batches</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {batches.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => toggle(batches, setBatches, b)}
                className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                aria-label={`Remove batch ${b}`}
              >
                {b} ×
              </button>
            ))}
            <input
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const v = batchInput.trim();
                if (v && !batches.includes(v)) setBatches([...batches, v]);
                setBatchInput("");
              }}
              list="batch-suggestions"
              placeholder="e.g. 2024"
              className="min-h-10 w-32 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
            />
            <datalist id="batch-suggestions">
              {knownBatches.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-[var(--text)]">Expires</legend>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {(["week", "month", "custom", "never"] as const).map((p) => (
            <label key={p} className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="expiry"
                checked={expiry === p}
                onChange={() => setExpiry(p)}
              />
              {p === "week" ? "1 week" : p === "month" ? "1 month" : p === "never" ? "Never" : "Custom"}
            </label>
          ))}
          {expiry === "custom" ? (
            <input
              type="datetime-local"
              value={customExpiry}
              onChange={(e) => setCustomExpiry(e.target.value)}
              className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
            />
          ) : null}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin to the top ({MAX_PINNED} at a time)
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={sendPush} onChange={(e) => setSendPush(e.target.checked)} />
          Send a push
        </label>
      </div>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {ok ? <p className="text-sm text-[var(--text-muted)]">{ok}</p> : null}

      <button
        type="submit"
        disabled={busy || !title.trim() || !body.trim()}
        className="min-h-12 w-full rounded-xl bg-[var(--brand)] font-medium text-white disabled:opacity-40 sm:w-auto sm:px-6"
      >
        {busy ? "Posting..." : "Post announcement"}
      </button>
    </form>
  );
}

/**
 * Client-side mirror of `expiryFor`, because a datetime the browser has not resolved cannot be sent
 * to the server as an ISO string. The server is still authoritative; this only avoids posting a
 * silently wrong date.
 */
function expiryForLocal(preset: ExpiryPreset, customIso: string): string | null {
  const now = Date.now();
  if (preset === "week") return new Date(now + 7 * 86_400_000).toISOString();
  if (preset === "month") return new Date(now + 30 * 86_400_000).toISOString();
  if (preset === "never") return null;
  if (!customIso) return null;
  const d = new Date(customIso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
