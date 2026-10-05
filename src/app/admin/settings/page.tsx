"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { availableTimeZones, isValidTimeZone } from "@/lib/time/church-time";
import { churchClock } from "@/lib/time/church-time";

type Definition = {
  key: string;
  type: "string" | "boolean" | "integer" | "timezone";
  default: string;
  exposed: boolean;
  section: string;
  description: string;
  usedBy: string;
  min?: number;
  max?: number;
  maxLength?: number;
};

type SettingsResponse = {
  values: Record<string, string>;
  updated_at: Record<string, string>;
  sections: Array<{ id: string; title: string; blurb: string }>;
  definitions: Definition[];
};

const TIMEZONES = availableTimeZones();

/**
 * SYS-1: the settings page.
 *
 * One section per card, each with its own **Save changes** button, because spec §SYS-1 asks for that and
 * because the sections have genuinely different consequences. Somebody changing the church's name has no
 * business being able to hit the same button that changes when "today" starts.
 *
 * ## The unsaved-changes warning
 *
 * `beforeunload` for a tab close, and an in-app confirm for navigating away, because the second is the one
 * that actually loses work: the security page is one link away and the report header is not something
 * anybody wants to retype.
 *
 * ## Validation happens twice
 *
 * The input's own rules give immediate feedback while typing, and the registry validates again on the
 * server. The duplicate is deliberate: the client check is a convenience and the server check is the one
 * that can actually refuse, because it is the only one an attacker has to pass.
 */
export default function AdminSettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/settings", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        setLoadError("Could not load the settings.");
        return;
      }
      const json = (await res.json()) as { data?: SettingsResponse };
      if (json.data) {
        setData(json.data);
        setDraft(json.data.values);
      }
    } catch {
      setLoadError("Could not load the settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Tab close or refresh.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // In-app navigation, which is the one that actually loses work.
  //
  // The listener is attached unconditionally and the dirty check moved inside the handler. It used to
  // be guarded by `if (!dirty.current) return` at the top of a `[]`-dependency effect, which runs once on
  // mount -- before any `edit()` had set the flag -- so it always returned early and the listener was
  // never registered. The confirm this file documents could therefore never fire, while the
  // `beforeunload` half above worked and made the omission easy to miss.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirty.current) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (!window.confirm("You have unsaved settings. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const definitionsBySection = useMemo(() => {
    const map = new Map<string, Definition[]>();
    for (const definition of data?.definitions ?? []) {
      const list = map.get(definition.section);
      if (list) list.push(definition);
      else map.set(definition.section, [definition]);
    }
    return map;
  }, [data]);

  function edit(key: string, value: string) {
    dirty.current = true;
    setSavedSection(null);
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function saveSection(section: string, keys: string[]) {
    setSaving(section);
    setErrors({});

    const body: Record<string, string> = {};
    for (const key of keys) body[key] = draft[key] ?? "";

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => null)) as
        | { data?: { saved: string[] }; error?: { message?: string; fields?: Record<string, string> } }
        | null;

      if (!res.ok) {
        setErrors(json?.error?.fields ?? { _form: json?.error?.message ?? "Could not save." });
        return;
      }

      dirty.current = false;
      setSavedSection(section);
      // Re-read so the page shows what was actually stored rather than what was typed.
      await load();
    } finally {
      setSaving(null);
    }
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-2xl border border-dashed border-[var(--danger)] p-6 text-center">
        <p className="text-sm text-[var(--danger)]">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return <p className="text-sm text-[var(--text-muted)]">Loading the settings…</p>;

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Each section saves on its own. PINs live on the Security page and batches live with Members.
        </p>
      </div>

      {errors._form ? (
        <p role="alert" className="rounded-xl border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          {errors._form}
        </p>
      ) : null}

      {data.sections.map((section) => {
        const keys = (definitionsBySection.get(section.id) ?? []).map((d) => d.key);
        if (keys.length === 0) return null;

        return (
          <section key={section.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand)]">{section.title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{section.blurb}</p>

            <div className="mt-4 space-y-4">
              {(definitionsBySection.get(section.id) ?? []).map((definition) => (
                <Field
                  key={definition.key}
                  definition={definition}
                  value={draft[definition.key] ?? definition.default}
                  error={errors[definition.key]}
                  onChange={(next) => edit(definition.key, next)}
                />
              ))}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={saving === section.id}
                onClick={() => void saveSection(section.id, keys)}
                className="min-h-12 rounded-xl bg-[var(--brand)] px-5 font-medium text-white disabled:opacity-40"
              >
                {saving === section.id ? "Saving…" : "Save changes"}
              </button>
              {savedSection === section.id ? (
                <span className="text-sm text-[var(--success)]">Saved.</span>
              ) : null}
            </div>
          </section>
        );
      })}

      <nav className="flex flex-wrap gap-3">
        <Link
          href="/admin/security"
          className="min-h-12 rounded-xl border border-[var(--border)] px-5 font-medium leading-[3rem]"
        >
          Security (PINs)
        </Link>
        <Link
          href="/admin/settings/system"
          className="min-h-12 rounded-xl border border-[var(--border)] px-5 font-medium leading-[3rem]"
        >
          System health
        </Link>
        <Link
          href="/admin/settings/backup"
          className="min-h-12 rounded-xl border border-[var(--border)] px-5 font-medium leading-[3rem]"
        >
          Data backup
        </Link>
      </nav>
    </div>
  );
}

function Field({
  definition,
  value,
  error,
  onChange,
}: {
  definition: Definition;
  value: string;
  error?: string;
  onChange: (next: string) => void;
}) {
  const id = `setting-${definition.key}`;

  if (definition.type === "boolean") {
    return (
      <div>
        <label className="flex min-h-11 items-center gap-2">
          <input
            id={id}
            type="checkbox"
            className="size-5"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          />
          <span className="text-sm font-medium">{humanise(definition.key)}</span>
        </label>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{definition.description}</p>
        {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  if (definition.type === "integer") {
    const out =
      value !== "" && (!/^\d+$/.test(value) || Number(value) < (definition.min ?? 0) || Number(value) > (definition.max ?? 1000));
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium">
          {humanise(definition.key)}
        </label>
        <input
          id={id}
          type="number"
          className="mt-1 min-h-12 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
          value={value}
          min={definition.min}
          max={definition.max}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={out || Boolean(error)}
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {definition.description}
          {definition.min !== undefined && definition.max !== undefined
            ? ` Between ${definition.min} and ${definition.max}.`
            : ""}
        </p>
        {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  if (definition.type === "timezone") {
    // The live clock is the check that matters: picking the wrong zone from a 400-item list is easy,
    // and "it says 5:30 AM and it is 6:30 outside" is the only way to notice before a report opens on
    // the wrong day.
    const valid = isValidTimeZone(value);
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium">
          {humanise(definition.key)}
        </label>
        <input
          id={id}
          type="text"
          list="timezone-suggestions"
          className="mt-1 min-h-12 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 sm:max-w-md"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!valid || Boolean(error)}
        />
        <datalist id="timezone-suggestions">
          {TIMEZONES.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {valid ? (
            <>It is currently {churchClock(value)} in that zone.</>
          ) : (
            <span className="text-[var(--danger)]">
              Not a recognised timezone. Use an IANA name such as Asia/Manila.
            </span>
          )}{" "}
          {definition.description}
        </p>
        {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {humanise(definition.key)}
      </label>
      <input
        id={id}
        type="text"
        className="mt-1 min-h-12 w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
        value={value}
        maxLength={definition.maxLength}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
      />
      <p className="mt-1 text-xs text-[var(--text-muted)]">{definition.description}</p>
      {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

function humanise(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}