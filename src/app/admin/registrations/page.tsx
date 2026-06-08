"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  batch: string | null;
};

type EditForm = {
  first_name: string;
  middle_initial: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  contact_number: string;
  batch: string;
};

export default function AdminRegistrationsPage() {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [batches, setBatches] = useState<string[]>([]);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    first_name: "",
    middle_initial: "",
    last_name: "",
    date_of_birth: "",
    gender: "",
    contact_number: "",
    batch: "",
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [batchBulk, setBatchBulk] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/registration-requests?status=${tab}`, { credentials: "same-origin" });
    const j = (await res.json()) as { requests?: Request[] };
    setRequests(j.requests ?? []);
    setSelected(new Set());
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/member-batches", { credentials: "same-origin" });
      if (!res.ok) return;
      const j = (await res.json()) as { batches: { id: string; year: string }[] };
      setBatches((j.batches ?? []).map((b) => b.year));
    })();
  }, []);

  const filteredRequests = useMemo(() => {
    if (requests === null) return [];
    const t = search.trim().toLowerCase();
    if (!t) return requests;
    return requests.filter((r) => {
      const mi = r.middle_initial ? ` ${r.middle_initial}.` : "";
      const name = `${r.first_name}${mi} ${r.last_name}`.toLowerCase();
      return name.includes(t);
    });
  }, [requests, search]);

  function startEdit(r: Request) {
    setEditForm({
      first_name: r.first_name,
      middle_initial: r.middle_initial ?? "",
      last_name: r.last_name,
      date_of_birth: r.date_of_birth,
      gender: r.gender,
      contact_number: r.contact_number,
      batch: r.batch ?? "",
    });
    setEditingId(r.id);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    setEditError(null);
    const body: Record<string, unknown> = { action: "update" };
    if (editForm.first_name.trim()) body.first_name = editForm.first_name.trim();
    if (editForm.last_name.trim()) body.last_name = editForm.last_name.trim();
    body.middle_initial = editForm.middle_initial.replace(".", "").trim();
    if (editForm.date_of_birth) body.date_of_birth = editForm.date_of_birth;
    if (editForm.gender) body.gender = editForm.gender;
    if (editForm.contact_number.trim()) body.contact_number = editForm.contact_number.trim();
    body.batch = editForm.batch || null;
    const res = await fetch(`/api/admin/registration-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      setEditError(j.error ?? "Could not save");
      return;
    }
    setEditingId(null);
    load();
  }

  async function changeStatus(id: string, newStatus: string) {
    setBusy(true);
    try {
      await fetch(`/api/admin/registration-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "change-status", new_status: newStatus }),
      });
      load();
    } finally {
      setBusy(false);
    }
  }

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

  async function setBatchOnPending(batch: string) {
    if (!batch || !requests) return;
    setBusy(true);
    try {
      const pending = selected.size > 0
        ? requests.filter((r) => r.status === "pending" && selected.has(r.id))
        : requests.filter((r) => r.status === "pending");
      for (const r of pending) {
        await fetch(`/api/admin/registration-requests/${r.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "update", batch }),
        });
      }
      setBatchBulk("");
      setSelected(new Set());
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
    const headers = ["Name", "Gender", "Date of Birth", "Contact Number", "Batch", "Status", "Submitted", "Reviewed"];
    const rows = requests.map((r) => {
      const mi = r.middle_initial ? ` ${r.middle_initial}.` : "";
      return [
        `${r.first_name}${mi} ${r.last_name}`,
        r.gender,
        r.date_of_birth,
        r.contact_number,
        r.batch ?? "",
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
          <select
            className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            value={batchBulk}
            onChange={(e) => setBatchBulk(e.target.value)}
          >
            <option value="">Set batch…</option>
            {batches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setBatchOnPending(batchBulk)}
            disabled={busy || !batchBulk}
            className="min-h-10 rounded-xl border border-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent)] disabled:opacity-40"
          >
            Set all to {batchBulk || "…"}
          </button>
        </div>
      ) : null}

      {requests === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <>
          <div>
            <label htmlFor="reg-search" className="sr-only">Search registration requests</label>
            <input
              id="reg-search"
              type="search"
              className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            {search.trim() !== "" ? (
              <p className="mt-1 text-sm text-[var(--muted)]">
                Showing {filteredRequests.length} of {requests.length}
              </p>
            ) : null}
          </div>
          {filteredRequests.length === 0 && requests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
              No {tab} requests.
            </p>
          ) : filteredRequests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
              No requests match your search.
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
                {filteredRequests.map((r) => {
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
                      {editingId === r.id ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              className="min-h-10 flex-1 rounded-lg border border-[var(--border)] px-2 text-sm"
                              placeholder="First name"
                              value={editForm.first_name}
                              onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                            />
                            <input
                              className="min-h-10 w-16 rounded-lg border border-[var(--border)] px-2 text-center text-sm"
                              placeholder="MI"
                              maxLength={1}
                              value={editForm.middle_initial}
                              onChange={(e) => setEditForm({ ...editForm, middle_initial: e.target.value.replace(".", "") })}
                            />
                            <input
                              className="min-h-10 flex-1 rounded-lg border border-[var(--border)] px-2 text-sm"
                              placeholder="Last name"
                              value={editForm.last_name}
                              onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                            />
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              type="date"
                              className="min-h-10 flex-1 rounded-lg border border-[var(--border)] px-2 text-sm"
                              title="Date of birth"
                              value={editForm.date_of_birth}
                              onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })}
                            />
                            <select
                              className="min-h-10 w-28 rounded-lg border border-[var(--border)] px-2 text-sm"
                              title="Gender"
                              value={editForm.gender}
                              onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}
                            >
                              <option value="">Gender</option>
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                            </select>
                            <input
                              type="tel"
                              className="min-h-10 flex-1 rounded-lg border border-[var(--border)] px-2 text-sm"
                              placeholder="Contact number"
                              value={editForm.contact_number}
                              onChange={(e) => setEditForm({ ...editForm, contact_number: e.target.value })}
                            />
                            <select
                              className="min-h-10 w-28 rounded-lg border border-[var(--border)] px-2 text-sm"
                              title="Batch"
                              value={editForm.batch}
                              onChange={(e) => setEditForm({ ...editForm, batch: e.target.value })}
                            >
                              <option value="">Batch</option>
                              {batches.map((b) => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => saveEdit(r.id)}
                              className="min-h-9 rounded-lg bg-[var(--accent)] px-3 text-sm text-white"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingId(null); setEditError(null); }}
                              className="min-h-9 text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                          {editError ? (
                            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{editError}</p>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <p className="font-medium text-[var(--text)]">{name}</p>
                          <div className="mt-1 space-y-0.5 text-sm text-[var(--muted)]">
                            <p>Gender: {r.gender}</p>
                            <p>DOB: {r.date_of_birth}</p>
                            <p>Contact: {r.contact_number}</p>
                            {r.batch ? <p>Batch: {r.batch}</p> : null}
                            <p>Submitted: {new Date(r.created_at).toLocaleString()}</p>
                            {r.reviewed_at ? (
                              <p>Reviewed: {new Date(r.reviewed_at).toLocaleString()}</p>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                      {editingId === r.id ? null : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            className="text-sm text-[var(--accent)]"
                          >
                            Edit
                          </button>
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) changeStatus(r.id, e.target.value);
                              e.target.value = "";
                            }}
                            disabled={busy}
                            className="min-h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
                          >
                            <option value="">Change status</option>
                            {r.status !== "pending" ? <option value="pending">Pending</option> : null}
                            {r.status !== "approved" ? <option value="approved">Approved</option> : null}
                            {r.status !== "rejected" ? <option value="rejected">Rejected</option> : null}
                          </select>
                          {tab === "pending" ? (
                            <>
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
                            </>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
          )}
        </>
      )}
    </div>
  );
}
