"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, MoreHorizontal, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { isApiResponse } from "@/lib/api/response";
import { normalizeName } from "@/lib/members/normalize-name";
import { ConflictDialog } from "@/features/registrations/ui/ConflictDialog";
import { EditRequestSheet } from "@/features/registrations/ui/EditRequestSheet";
import { RejectDialog } from "@/features/registrations/ui/RejectDialog";
import {
  TABS,
  duplicateLabel,
  formatSubmitted,
  formatSubmittedTime,
  type RegistrationRequest,
  type RequestCounts,
  type Tab,
} from "@/features/registrations/ui/types";

const PAGE_SIZE = 25;

type ListResponse = {
  requests: RegistrationRequest[];
  counts: RequestCounts;
  page: number;
  page_size: number;
  total: number;
};

export function RegistrationReviewTable() {
  const [tab, setTab] = useState<Tab>("pending");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RegistrationRequest[] | null>(null);
  const [counts, setCounts] = useState<RequestCounts>({ pending: 0, approved: 0, rejected: 0 });
  const [total, setTotal] = useState(0);
  const [batches, setBatches] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  /** The load failed: the table must not claim "No applications" underneath the notice. */
  const [loadFailed, setLoadFailed] = useState(false);

  const [editTarget, setEditTarget] = useState<RegistrationRequest | null>(null);
  const [rejectFor, setRejectFor] = useState<RegistrationRequest[] | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<RegistrationRequest[] | null>(null);
  const [conflict, setConflict] = useState<{
    message: string;
    name: string;
    memberId: string | null;
    target: RegistrationRequest;
  } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/admin/registration-requests?status=${tab}&page=${page}&page_size=${PAGE_SIZE}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    const body: unknown = await res.json().catch(() => null);
    if (!isApiResponse<ListResponse>(body) || !body.ok) {
      // Used to set `rows` to [], which rendered the "No pending applications." empty state -- the
      // same screen a 500 and an honest empty tab produce. That is not a safe guess about the queue,
      // so the failure is stated and the table is not given a list to be proud of.
      setRows(null);
      setLoadFailed(true);
      setNotice({
        tone: "error",
        text: isApiResponse(body) && !body.ok ? body.error.message : "Could not load applications.",
      });
      return;
    }
    setLoadFailed(false);
    setRows(body.data.requests);
    setCounts(body.data.counts);
    setTotal(body.data.total);
    setSelected(new Set());
  }, [tab, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/member-batches", { credentials: "same-origin" });
      if (!res.ok) return;
      const body: unknown = await res.json().catch(() => null);
      if (isApiResponse<{ batches?: { year: string }[] }>(body) && body.ok) {
        setBatches((body.data.batches ?? []).map((b) => b.year));
      }
    })();
  }, []);

  // Filtering happens on the page already loaded, so typing stays instant.
  // Server-side search is added with the member directory.
  const visible = useMemo(() => {
    if (!rows) return [];
    const q = normalizeName(search.trim());
    if (!q) return rows;
    return rows.filter((r) => normalizeName(r.full_name).includes(q));
  }, [rows, search]);

  const allOnPageSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      if (visible.every((r) => prev.has(r.id))) {
        const next = new Set(prev);
        for (const r of visible) next.delete(r.id);
        return next;
      }
      const next = new Set(prev);
      for (const r of visible) next.add(r.id);
      return next;
    });
  }

  async function run(
    call: { url: string; method: "POST" | "PATCH"; payload: Record<string, unknown> },
    successText: string,
    clearedIds: string[],
  ): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(call.url, {
        method: call.method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(call.payload),
      });
      const parsed: unknown = await res.json().catch(() => null);
      if (!isApiResponse<Record<string, unknown>>(parsed) || !parsed.ok) {
        const message =
          isApiResponse(parsed) && !parsed.ok ? parsed.error.message : "Something went wrong.";
        setNotice({ tone: "error", text: message });
        return false;
      }
      setNotice({ tone: "success", text: successText });
      if (clearedIds.length > 0) {
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of clearedIds) next.delete(id);
          return next;
        });
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  /**
   * A single approve can hit the REG-6 conflict; a bulk one reports the rows it
   * could not do instead of failing the whole batch.
   */
  async function approve(targets: RegistrationRequest[]) {
    if (targets.length === 1) {
      const r = targets[0];
      const res = await fetch(`/api/admin/registration-requests/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "approve" }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (isApiResponse(body) && !body.ok && body.error.code === "CONFLICT") {
        setConflict({
          message: body.error.message,
          name: body.error.fields?.conflict_name ?? r.full_name,
          memberId: body.error.fields?.conflict_member_id ?? null,
          target: r,
        });
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        if (isApiResponse(body) && body.ok) {
          setNotice({ tone: "success", text: `${r.full_name} approved.` });
          await load();
        } else {
          setNotice({
            tone: "error",
            text: isApiResponse(body) && !body.ok ? body.error.message : "Could not approve.",
          });
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/registration-requests/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "approve",
          ids: targets.map((r) => r.id),
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!isApiResponse<{ processed: number; skipped: { name: string; reason: string }[] }>(body) || !body.ok) {
        setNotice({
          tone: "error",
          text: isApiResponse(body) && !body.ok ? body.error.message : "Could not approve.",
        });
        return;
      }
      const skipped = body.data.skipped;
      setNotice({
        tone: skipped.length > 0 ? "error" : "success",
        text:
          skipped.length > 0
            ? `${body.data.processed} approved, ${skipped.length} left alone. ${skipped[0].name}: ${skipped[0].reason}`
            : `${body.data.processed} applications approved.`,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function reject(targets: RegistrationRequest[], reason: string, note: string) {
    if (targets.length === 1) {
      await run(
        {
          url: `/api/admin/registration-requests/${targets[0].id}`,
          method: "PATCH",
          payload: { action: "reject", reason, note },
        },
        `${targets[0].full_name} rejected.`,
        [targets[0].id],
      );
      return;
    }
    await run(
      {
        url: "/api/admin/registration-requests/bulk",
        method: "POST",
        payload: { action: "reject", ids: targets.map((r) => r.id), reason, note },
      },
      `${targets.length} applications rejected.`,
      targets.map((r) => r.id),
    );
  }

  async function changeStatus(r: RegistrationRequest, next: Tab) {
    await run(
      {
        url: `/api/admin/registration-requests/${r.id}`,
        method: "PATCH",
        payload: { action: "change-status", new_status: next },
      },
      `${r.full_name} moved to ${next}.`,
      [],
    );
  }

  const selectedRows = (rows ?? []).filter((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Registration requests</h1>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/admin/registration-requests/pdf?status=${tab}`}>
            <Download aria-hidden className="size-4" />
            PDF of this tab
          </a>
        </Button>
      </div>

      <div role="tablist" aria-label="Application status" className="flex gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-[var(--brand)] text-[var(--brand)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
            <span className="ml-2 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs tabular-nums">
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-xl border p-3 text-sm ${
            notice.tone === "error"
              ? "border-[var(--danger)] text-[var(--danger)]"
              : "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <Label htmlFor="reg-search" className="sr-only">
          Search by name
        </Label>
        <Input
          id="reg-search"
          type="search"
          className="pl-9"
          placeholder="Search by name on this page"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--brand)] bg-[var(--surface)] p-2">
          <span className="px-2 text-sm font-medium">
            {selected.size} selected
          </span>
          <Button size="sm" disabled={busy} onClick={() => setConfirmApprove(selectedRows)}>
            Approve {selected.size}
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => setRejectFor(selectedRows)}>
            Reject {selected.size}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      {rows === null && !loadFailed ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : loadFailed ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">
          Could not load the applications.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--text-muted)]">
          {(rows ?? []).length === 0 ? `No ${tab} applications.` : "No applications match your search."}
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-[var(--border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                      className="size-4 accent-[var(--brand)]"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Date of birth</TableHead>
                  <TableHead className="hidden md:table-cell">Gender</TableHead>
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead className="hidden sm:table-cell">Batch</TableHead>
                  <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const flag = duplicateLabel(r);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.full_name}`}
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                          className="size-4 accent-[var(--brand)]"
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {r.full_name}
                        {r.reference_code ? (
                          <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">
                            {r.reference_code}
                          </span>
                        ) : null}
                        <span className="block text-xs text-[var(--text-muted)] sm:hidden">
                          {formatSubmitted(r.created_at)}
                          {r.date_of_birth ? ` · ${r.date_of_birth}` : ""}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{r.date_of_birth || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell capitalize">
                        {r.gender || "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{r.contact_number || "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell">{r.batch || "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {formatSubmitted(r.created_at)}
                        {r.reviewed_at ? (
                          <span className="block text-xs text-[var(--text-muted)]">
                            reviewed {formatSubmittedTime(r.reviewed_at)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {flag ? (
                          <Badge variant="outline" className="whitespace-normal text-xs">
                            {flag}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">—</span>
                        )}
                        {r.reject_reason ? (
                          <Badge variant="secondary" className="mt-1 block whitespace-normal text-xs">
                            {r.reject_reason}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${r.full_name}`}>
                              <MoreHorizontal aria-hidden className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {r.status === "pending" ? (
                              <>
                                <DropdownMenuItem
                                  disabled={busy}
                                  onClick={() => void approve([r])}
                                >
                                  Approve
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={busy}
                                  onClick={() => setRejectFor([r])}
                                >
                                  Reject…
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            ) : (
                              <>
                                <DropdownMenuLabel>Change status</DropdownMenuLabel>
                                {TABS.filter((t) => t.key !== r.status).map((t) => (
                                  <DropdownMenuItem
                                    key={t.key}
                                    disabled={busy}
                                    onClick={() => void changeStatus(r, t.key)}
                                  >
                                    Move to {t.label}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem
                              disabled={busy || r.status === "approved"}
                              onClick={() => setEditTarget(r)}
                            >
                              Edit
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-[var(--text-muted)]">
                Page {page} of {pageCount} · {total} total
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}

      <EditRequestSheet
        request={editTarget}
        batches={batches}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        onSave={(values) => {
          if (!editTarget) return;
          void run(
            {
              url: `/api/admin/registration-requests/${editTarget.id}`,
              method: "PATCH",
              payload: { action: "update", ...values },
            },
            "Changes saved.",
            [],
          ).then((ok) => {
            if (ok) setEditTarget(null);
          });
        }}
      />

      <RejectDialog
        open={rejectFor !== null}
        count={rejectFor?.length ?? 0}
        busy={busy}
        initialReason={conflict ? "Duplicate application" : undefined}
        onOpenChange={(open) => {
          if (!open) setRejectFor(null);
        }}
        onConfirm={(reason, note) => {
          const targets = rejectFor;
          setRejectFor(null);
          if (targets) void reject(targets, reason, note);
        }}
      />

      <AlertDialog
        open={confirmApprove !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmApprove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve {confirmApprove?.length ?? 0}{" "}
              {confirmApprove?.length === 1 ? "application" : "applications"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each one becomes a member straight away. Anyone whose name matches an
              existing member is left pending and listed so you can handle them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const targets = confirmApprove;
                setConfirmApprove(null);
                if (targets) void approve(targets);
              }}
            >
              Approve {confirmApprove?.length ?? 0}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConflictDialog
        open={conflict !== null}
        message={conflict?.message ?? ""}
        memberName={conflict?.name ?? ""}
        conflictMemberId={conflict?.memberId ?? null}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
        onEditName={() => {
          const target = conflict?.target;
          setConflict(null);
          if (target) setEditTarget(target);
        }}
        onRejectAsDuplicate={() => {
          const target = conflict?.target;
          setConflict(null);
          if (target) setRejectFor([target]);
        }}
        onLink={async (memberId) => {
          const target = conflict?.target;
          if (!target) return;
          setBusy(true);
          try {
            const res = await fetch(`/api/admin/registration-requests/${target.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: "link-member", member_id: memberId }),
            });
            const body: unknown = await res.json().catch(() => null);
            if (!isApiResponse(body) || !body.ok) {
              throw new Error(
                isApiResponse(body) && !body.ok ? body.error.message : "Could not link the member.",
              );
            }
            setConflict(null);
            setNotice({
              tone: "success",
              text: `${target.full_name} approved and linked to an existing member.`,
            });
            await load();
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
