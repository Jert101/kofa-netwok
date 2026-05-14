"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export function LogoutBar() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function logout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      router.replace("/login");
      router.refresh();
    } finally {
      setLoading(false);
      setOpen(false);
    }
  }

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Image src="/logo.png" alt="KofA logo" width={32} height={32} className="shrink-0 rounded-full" />
          <p className="truncate text-sm font-semibold text-[var(--accent)]">KofA Attendance</p>
        </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 min-w-[5.5rem] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--text)] active:scale-[0.98]"
      >
        Log out
      </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-5 shadow-xl"
          >
            <h2 id="logout-title" className="text-lg font-semibold text-[var(--text)]">
              Log out?
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">You will need your PIN to sign in again.</p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-12 flex-1 rounded-xl border border-[var(--border)] font-medium"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={logout}
                disabled={loading}
                className="min-h-12 flex-1 rounded-xl bg-[var(--danger)] font-medium text-white"
              >
                {loading ? "…" : "Log out"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
