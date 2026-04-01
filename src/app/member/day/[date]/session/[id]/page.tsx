"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type MemberRow = { member_id: string; full_name: string };

export default function MemberSessionDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const router = useRouter();
  const [massName, setMassName] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/attendance/session/${id}`, { credentials: "same-origin" });
      if (!res.ok) {
        router.replace("/member");
        return;
      }
      const j = (await res.json()) as {
        session: { mass_name: string };
        members: MemberRow[];
      };
      if (!cancelled) {
        setMassName(j.session.mass_name);
        setMembers(j.members);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return members;
    return members.filter((m) => m.full_name.toLowerCase().includes(t));
  }, [members, q]);

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
      <input
        type="search"
        placeholder="Search names"
        className="mt-4 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
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
