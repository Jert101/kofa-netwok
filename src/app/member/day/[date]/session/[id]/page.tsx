"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AttendanceAppealForm } from "@/components/AttendanceAppealForm";

type MemberRow = { member_id: string; full_name: string };

type LiturgyLine = {
  position_label: string;
  member_name: string | null;
  free_text: string | null;
};

export default function MemberSessionDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const router = useRouter();
  const [massName, setMassName] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [liturgy, setLiturgy] = useState<LiturgyLine[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [rosterVersion, setRosterVersion] = useState(0);
  const [appealSubmitting, setAppealSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await fetch(`/api/attendance/session/${id}`, { credentials: "same-origin" });
        if (!cancelled && res.status === 404) {
          router.replace("/member");
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setLoadError(true);
            setLoading(false);
          }
          return;
        }
        const j = (await res.json()) as {
          session: { mass_name: string };
          members: MemberRow[];
          liturgy_servers?: LiturgyLine[];
        };
        if (!cancelled) {
          setMassName(j.session.mass_name);
          setMembers(j.members);
          setLiturgy(
            (j.liturgy_servers ?? []).map((r) => ({
              position_label: r.position_label,
              member_name: r.member_name,
              free_text: r.free_text,
            }))
          );
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router, reloadKey]);

  useEffect(() => {
    if (rosterVersion === 0 || !id) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/attendance/session/${id}`, { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as { members: MemberRow[]; liturgy_servers?: LiturgyLine[] };
      if (!cancelled) {
        setMembers(j.members);
        setLiturgy(
          (j.liturgy_servers ?? []).map((r) => ({
            position_label: r.position_label,
            member_name: r.member_name,
            free_text: r.free_text,
          }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, rosterVersion]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return members;
    return members.filter((m) => m.full_name.toLowerCase().includes(t));
  }, [members, q]);

  return (
    <div aria-busy={appealSubmitting || undefined}>
      <button
        type="button"
        onClick={() => router.back()}
        disabled={appealSubmitting}
        className="mb-3 min-h-11 text-sm font-medium text-[var(--accent)] disabled:pointer-events-none disabled:opacity-40"
      >
        ← Back
      </button>
      <h1 className="text-lg font-semibold sm:text-xl">
        {loading ? <span className="inline-block h-7 w-48 animate-pulse rounded bg-[var(--surface-2)]" /> : massName}
      </h1>
      {loadError ? (
        <div role="alert" className="mt-4 rounded-2xl border border-dashed border-[var(--danger)] p-6 text-center">
          <p className="text-sm font-medium text-[var(--danger)]">Could not load this session.</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
          >
            Retry
          </button>
        </div>
      ) : null}
      {!loading && !loadError ? (
        <AttendanceAppealForm
          sessionId={id}
          onAppealSubmitted={() => setRosterVersion((v) => v + 1)}
          onSubmittingChange={setAppealSubmitting}
        />
      ) : null}
      {!loading && liturgy.length > 0 ? (
        <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--accent)]">Liturgy servers</h2>
          <ul className="mt-2 space-y-2">
            {liturgy.map((row, i) => {
              const parts = [row.member_name, row.free_text].filter(Boolean);
              const who = parts.length ? parts.join(" · ") : "—";
              return (
                <li key={i} className="flex flex-col gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="text-sm font-medium text-[var(--text)]">{row.position_label}</span>
                  <span className="text-sm text-[var(--muted)]">{who}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <label htmlFor="roster-search" className="sr-only">
        Search names
      </label>
      <input
        id="roster-search"
        type="search"
        placeholder="Search names"
        aria-describedby="roster-count"
        className="mt-5 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={appealSubmitting}
      />
      <p id="roster-count" className="sr-only" aria-live="polite">
        {filtered.length} of {members.length} names shown
      </p>
      <ul className="mt-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        {filtered.map((m) => (
          <li key={m.member_id} className="px-4 py-3 text-base">
            {m.full_name}
          </li>
        ))}
        {!loading && filtered.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">No matches</li>
        ) : null}
      </ul>
    </div>
  );
}
