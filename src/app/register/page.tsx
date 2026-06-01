"use client";

import { useState } from "react";
import Image from "next/image";

export default function RegisterPage() {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    middle_initial: "",
    date_of_birth: "",
    gender: "",
    contact_number: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErr(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(data.error ?? "Registration failed");
        return;
      }
      setSuccess(true);
    } catch {
      setErr("Could not submit registration");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-sm sm:p-8">
          <div className="mb-3 flex justify-center">
            <Image src="/logo.png" alt="KofA logo" width={72} height={72} className="rounded-full" priority />
          </div>
          <h1 className="text-xl font-semibold text-[var(--accent)]">Registration submitted</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your application is pending approval. An admin will review it shortly.
          </p>
        </div>
      </main>
    );
  }

  const yearNow = new Date().getFullYear();
  const minYear = yearNow - 100;
  const maxYear = yearNow - 10;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-8">
        <div className="mb-3 flex justify-center">
          <Image src="/logo.png" alt="Knights of the Altar logo" width={72} height={72} className="rounded-full" priority />
        </div>
        <h1 className="text-center text-xl font-semibold text-[var(--accent)]">Join Knights of the Altar</h1>
        <p className="mt-1 text-center text-sm text-[var(--muted)]">Fill out the form to register</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-[var(--muted)]">First name</span>
              <input
                required
                className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3"
                value={form.first_name}
                onChange={(e) => update("first_name", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[var(--muted)]">Last name</span>
              <input
                required
                className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3"
                value={form.last_name}
                onChange={(e) => update("last_name", e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[var(--muted)]">Middle initial (optional)</span>
            <input
              maxLength={2}
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3"
              value={form.middle_initial}
              onChange={(e) => update("middle_initial", e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[var(--muted)]">Date of birth</span>
            <input
              required
              type="date"
              min={`${minYear}-01-01`}
              max={`${maxYear}-12-31`}
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3"
              value={form.date_of_birth}
              onChange={(e) => update("date_of_birth", e.target.value)}
            />
          </label>

          <fieldset>
            <legend className="text-sm font-medium text-[var(--muted)]">Gender</legend>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  required
                  type="radio"
                  name="gender"
                  value="male"
                  checked={form.gender === "male"}
                  onChange={(e) => update("gender", e.target.value)}
                />
                Male
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="gender"
                  value="female"
                  checked={form.gender === "female"}
                  onChange={(e) => update("gender", e.target.value)}
                />
                Female
              </label>
            </div>
          </fieldset>

          <label className="block">
            <span className="text-sm font-medium text-[var(--muted)]">Contact number</span>
            <input
              required
              type="tel"
              className="mt-1 w-full min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3"
              value={form.contact_number}
              onChange={(e) => update("contact_number", e.target.value)}
              placeholder="09xxxxxxxxx"
            />
          </label>

          {err ? <p className="text-sm text-[var(--danger)]">{err}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="min-h-14 w-full rounded-xl bg-[var(--accent)] text-base font-semibold text-white disabled:opacity-40"
          >
            {loading ? "Submitting…" : "Submit registration"}
          </button>
        </form>
      </div>
    </main>
  );
}
