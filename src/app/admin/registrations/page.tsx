"use client";

import { useCallback, useEffect, useState } from "react";

type Request = {
  id: string;
  first_name: string;
  last_name: string;
  middle_initial: string | null;
  date_of_birth: string;
  gender: string;
  contact_number: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
};

export default function AdminRegistrationsPage() {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/registration-requests?status=${tab}`, { credentials: "same-origin" });
    const j = (await res.json()) as { requests?: Request[] };
    setRequests(j.requests ?? []);
    setSelected(new Set());
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function reviewSingle(id: string, action: "approve" | "reject") {
    setBusy(true);
    try {
      await fetch(`/api/admin/registration-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action }),
      });
      load();
    } finally {
      setBusy(false);
    }
  }

  async function reviewBulk(action: "approve" | "reject") {
    setBusy(true);
    try {
      await fetch("/api/admin/registration-requests/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action,
          ids: selected.size > 0 ? [...selected] : undefined,
        }),
      });
      load();
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!requests) return;
    if (selected.size === requests.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(requests.map((r) => r.id)));
    }
  }

  const allSelected = Boolean(requests && requests.length > 0 && selected.size === requests.length);

  function downloadCsv() {
    if (!requests || requests.length === 0) return;
    const headers = ["Name", "Gender", "Date of Birth", "Contact Number", "Status", "Submitted", "Reviewed"];
    const rows = requests.map((r) => {
      const mi = r.middle_initial ? ` ${r.middle_initial}.` : "";
      return [
        `${r.first_name}${mi} ${r.last_name}`,
        r.gender,
        r.date_of_birth,
        r.contact_number,
        r.status,
        new Date(r.created_at).toLocaleString(),
        r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : "",
      ];
    });
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `registration-requests-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Registration requests</h1>
        {requests !== null ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-[var(--muted)]">
              Total: <span className="font-medium text-[var(--foreground)]">{requests.length}</span>
            </p>
            <a
              href={`/api/admin/registration-requests/pdf?status=${tab}`}
              className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--accent)]"
            >
              Download PDF
            </a>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={requests.length === 0}
              className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--accent)] disabled:opacity-40"
            >
              Download CSV
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2 border-b border-[var(--border)] pb-2">
        {(["pending", "approved", "rejected"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-9 rounded-lg px-4 text-sm font-medium capitalize ${
              tab === t
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "pending" && requests && requests.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => reviewBulk("approve")}
            disabled={busy || selected.size === 0}
            className="min-h-10 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            Approve selected ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => reviewBulk("reject")}
            disabled={busy || selected.size === 0}
            className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold text-[var(--muted)] disabled:opacity-40"
          >
            Reject selected ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => reviewBulk("approve")}
            disabled={busy || requests.length === 0}
            className="min-h-10 rounded-xl border border-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent)] disabled:opacity-40"
          >
            Approve all
          </button>
          <button
            type="button"
            onClick={() => reviewBulk("reject")}
            disabled={busy || requests.length === 0}
            className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold text-[var(--muted)] disabled:opacity-40"
          >
            Reject all
          </button>
        </div>
      ) : null}

      {requests === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
          No {tab} requests.
        </p>
      ) : (
        <>
          {tab === "pending" ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="h-5 w-5 rounded border-[var(--border)]"
              />
              Select all
            </label>
          ) : null}
          <ul className="space-y-3">
            {requests.map((r) => {
              const mi = r.middle_initial ? ` ${r.middle_initial}.` : "";
              const name = `${r.first_name}${mi} ${r.last_name}`;
              return (
                <li
                  key={r.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      {tab === "pending" ? (
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          className="mt-1 h-5 w-5 shrink-0 rounded border-[var(--border)]"
                        />
                      ) : null}
                      <div>
                        <p className="font-medium text-[var(--text)]">{name}</p>
                        <div className="mt-1 space-y-0.5 text-sm text-[var(--muted)]">
                          <p>Gender: {r.gender}</p>
                          <p>DOB: {r.date_of_birth}</p>
                          <p>Contact: {r.contact_number}</p>
                          <p>Submitted: {new Date(r.created_at).toLocaleString()}</p>
                          {r.reviewed_at ? (
                            <p>Reviewed: {new Date(r.reviewed_at).toLocaleString()}</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {tab === "pending" ? (
                      <div className="flex gap-2 sm:shrink-0">
                        <button
                          type="button"
                          onClick={() => reviewSingle(r.id, "approve")}
                          disabled={busy}
                          className="min-h-10 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewSingle(r.id, "reject")}
                          disabled={busy}
                          className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold text-[var(--muted)] disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
