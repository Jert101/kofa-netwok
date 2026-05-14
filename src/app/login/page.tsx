"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ROLE_PATH, type Role } from "@/lib/auth/roles";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
        credentials: "same-origin",
      });
      const data = (await res.json()) as { error?: string; role?: Role };
      if (!res.ok) {
        setErr(data.error ?? "Could not sign in");
        return;
      }
      if (data.role) {
        router.replace(ROLE_PATH[data.role]);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-8">
        <div className="mb-3 flex justify-center">
          <Image src="/logo.png" alt="Knights of the Altar logo" width={72} height={72} className="rounded-full" priority />
        </div>
        <h1 className="text-center text-xl font-semibold text-[var(--accent)]">Knights of the Altar</h1>
        <p className="mt-1 text-center text-sm text-[var(--muted)]">Attendance monitoring</p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[var(--muted)]">PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="mt-2 w-full min-h-14 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-lg tracking-widest"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              maxLength={12}
            />
          </label>
          {err ? <p className="text-sm text-[var(--danger)]">{err}</p> : null}
          <button
            type="submit"
            disabled={loading || pin.length < 4}
            className="min-h-14 w-full rounded-xl bg-[var(--accent)] text-base font-semibold text-white disabled:opacity-40"
          >
            {loading ? "Signing in…" : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
