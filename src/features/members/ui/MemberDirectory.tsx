"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileDown, MoreHorizontal, Plus, Search, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isApiResponse } from "@/lib/api/response";
import { DeactivateDialog } from "@/features/members/ui/DeactivateDialog";
import { MemberSheet } from "@/features/members/ui/MemberSheet";
import {
  MEMBER_SORTS,
  MEMBER_STATUSES,
  type MemberListResult,
  type MemberRow,
  type MemberSort,
  type MemberStatus,
} from "@/features/members/member-query";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ALL = "__all__";
const NO_BATCH = "__none__";

const COLUMNS = [
  { key: "batch", label: "Batch" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "gender", label: "Gender" },
  { key: "contact_number", label: "Contact" },
  { key: "status", label: "Status" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  all: "All",
};

const SORT_LABEL: Record<MemberSort, string> = {
  name: "Name",
  batch: "Batch",
  date_of_birth: "Date of birth",
};

type State = {
  status: MemberStatus;
  batch: string;
  gender: string;
  birth_month: string;
  sort: MemberSort;
  dir: "asc" | "desc";
};

const INITIAL: State = {
  status: "active",
  batch: "",
  gender: "",
  birth_month: "",
  sort: "name",
  dir: "asc",
};

export function MemberDirectory() {
  const [filters, setFilters] = useState<State>(INITIAL);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MemberListResult | null>(null);
  const [batches, setBatches] = useState<string[]>([]);
  const [hidden, setHidden] = useState<ColumnKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<MemberRow | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  // Changing what is being searched invalidates the page number. Done here, at the
  // source, rather than in an effect: an effect would run *after* the fetch for the
  // old page had already gone out, so searching from page 5 would first ask for
  // page 5 of the new result, show an empty table for a moment, and then correct
  // itself. Both states changing in one commit means only the right page is asked
  // for.
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = q.trim();
      setDebouncedQ((prev) => {
        if (prev !== trimmed) setPage(1);
        return trimmed;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const updateFilters = useCallback((patch: Partial<State>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", filters.status);
    if (filters.batch) params.set("batch", filters.batch);
    if (filters.gender) params.set("gender", filters.gender);
    if (filters.birth_month) params.set("birth_month", filters.birth_month);
    if (debouncedQ) params.set("q", debouncedQ);
    params.set("sort", filters.sort);
    params.set("dir", filters.dir);
    return params.toString();
  }, [filters, debouncedQ]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/members?${queryString}&page=${page}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body: unknown = await res.json().catch(() => null);
    if (!isApiResponse<MemberListResult>(body) || !body.ok) {
      setData(null);
      setNotice({
        tone: "error",
        text: isApiResponse(body) && !body.ok ? body.error.message : "Could not load members.",
      });
      return;
    }
    setData(body.data);
  }, [queryString, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/member-batches", { credentials: "same-origin" });
      const body: unknown = await res.json().catch(() => null);
      if (isApiResponse<{ batches?: { year: string }[] }>(body) && body.ok) {
        setBatches((body.data.batches ?? []).map((b) => b.year));
      }
    })();
  }, []);

  // Any filter change invalidates the current page number. See the debounced Q
  // effect above for why it is reset there when the text changes.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  const exportQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", filters.status);
    if (filters.batch) params.set("batch", filters.batch);
    if (filters.gender) params.set("gender", filters.gender);
    if (filters.birth_month) params.set("birth_month", filters.birth_month);
    if (debouncedQ) params.set("q", debouncedQ);
    params.set("sort", filters.sort);
    params.set("dir", filters.dir);
    return params.toString();
  }, [filters, debouncedQ]);

  const members = data?.members ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Members</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/admin/members/csv?${exportQuery}`}>
              <Download aria-hidden className="size-4" />
              CSV
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/admin/members/pdf?${exportQuery}`}>
              <FileDown aria-hidden className="size-4" />
              PDF
            </a>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setSheetError(null);
              setSheetOpen(true);
            }}
          >
            <Plus aria-hidden className="size-4" />
            Add member
          </Button>
        </div>
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

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted)]"
          />
          <Label htmlFor="member-search" className="sr-only">
            Search members
          </Label>
          <Input
            id="member-search"
            type="search"
            className="pl-9"
            placeholder="Search name, contact or batch"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <Select
          value={filters.status}
          onValueChange={(v) => updateFilters({ status: v as MemberStatus })}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMBER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.batch || NO_BATCH}
          onValueChange={(v) => updateFilters({ batch: v === NO_BATCH ? "" : v })}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Any batch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_BATCH}>Any batch</SelectItem>
            {batches.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.gender || ALL}
          onValueChange={(v) => updateFilters({ gender: v === ALL ? "" : v })}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Any gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any gender</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.birth_month || ALL}
          onValueChange={(v) => updateFilters({ birth_month: v === ALL ? "" : v })}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Any month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any month</SelectItem>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1)}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.sort}
          onValueChange={(v) => updateFilters({ sort: v as MemberSort })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMBER_SORTS.map((s) => (
              <SelectItem key={s} value={s}>
                Sort: {SORT_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="icon"
          aria-label={filters.dir === "asc" ? "Sort descending" : "Sort ascending"}
          onClick={() => updateFilters({ dir: filters.dir === "asc" ? "desc" : "asc" })}
        >
          <span className="text-xs font-semibold">{filters.dir === "asc" ? "↑" : "↓"}</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Choose columns">
              <Settings2 aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={!hidden.includes(c.key)}
                onCheckedChange={(checked) =>
                  setHidden((prev) =>
                    checked ? prev.filter((k) => k !== c.key) : [...prev, c.key],
                  )
                }
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {data ? (
        <p className="text-sm text-[var(--muted)]">
          {data.total} member{data.total === 1 ? "" : "s"}
          {filters.birth_month
            ? ` born in ${MONTHS[Number(filters.birth_month) - 1]}`
            : ""}
        </p>
      ) : null}

      {data === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
          No members match these filters.
        </p>
      ) : (
        <>
          {/* A table cannot be read on a narrow phone, so it becomes cards. */}
          <div className="hidden md:block">
            <div className="rounded-xl border border-[var(--border)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    {COLUMNS.filter((c) => !hidden.includes(c.key)).map((c) => (
                      <TableHead key={c.key}>{c.label}</TableHead>
                    ))}
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        <Link href={`/admin/members/${m.id}`} className="hover:underline">
                          {m.full_name}
                        </Link>
                      </TableCell>
                      {COLUMNS.filter((c) => !hidden.includes(c.key)).map((c) => (
                        <TableCell key={c.key}>
                          {c.key === "status" ? (
                            <Badge variant={m.is_active ? "default" : "secondary"}>
                              {m.is_active ? "Active" : "Inactive"}
                            </Badge>
                          ) : c.key === "gender" ? (
                            <span className="capitalize">{m.gender ?? "—"}</span>
                          ) : (
                            (m[c.key] as string | null) ?? "—"
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Menu
                          member={m}
                          busy={busy}
                          onEdit={() => {
                            setEditing(m);
                            setSheetError(null);
                            setSheetOpen(true);
                          }}
                          onDeactivate={() => {
                            setDeactivating(m);
                            setDeactivateError(null);
                          }}
                          onReactivated={async () => {
                            setNotice({ tone: "success", text: `${m.full_name} reactivated.` });
                            await load();
                          }}
                          onError={(text) => setNotice({ tone: "error", text })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <ul className="space-y-2 md:hidden">
            {members.map((m) => (
              <li key={m.id} className="rounded-2xl border border-[var(--border)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/admin/members/${m.id}`}
                      className="font-medium hover:underline"
                    >
                      {m.full_name}
                    </Link>
                    <p className="text-sm text-[var(--muted)]">
                      {m.batch ? `Batch ${m.batch}` : "No batch"}
                      {m.date_of_birth ? ` · ${m.date_of_birth}` : ""}
                    </p>
                  </div>
                  <Badge variant={m.is_active ? "default" : "secondary"}>
                    {m.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {!m.is_active && m.deactivation_reason ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {m.deactivation_reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          {data.pageCount > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-[var(--muted)]">
                Page {data.page} of {data.pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}

      <MemberSheet
        open={sheetOpen}
        member={editing}
        batches={batches}
        busy={busy}
        error={sheetError}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(null);
        }}
        onSubmit={(values) => {
          const isEdit = editing !== null;
          setSheetError(null);
          void (async () => {
            const res = await fetch(
              isEdit ? `/api/admin/members/${editing.id}` : "/api/admin/members",
              {
                method: isEdit ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(isEdit ? { action: "update", ...values } : values),
              },
            );
            const body: unknown = await res.json().catch(() => null);
            if (!isApiResponse(body) || !body.ok) {
              setSheetError(
                isApiResponse(body) && !body.ok
                  ? (Object.values(body.error.fields ?? {})[0] ?? body.error.message)
                  : "Could not save.",
              );
              return;
            }
            setSheetOpen(false);
            setNotice({
              tone: "success",
              text: isEdit ? "Member updated." : "Member added.",
            });
            await load();
          })();
        }}
      />

      <DeactivateDialog
        open={deactivating !== null}
        name={deactivating?.full_name ?? ""}
        busy={busy}
        error={deactivateError}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        onConfirm={(reason, note) => {
          const target = deactivating;
          if (!target) return;
          setDeactivateError(null);
          void (async () => {
            setBusy(true);
            const res = await fetch(`/api/admin/members/${target.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: "deactivate", reason, note }),
            });
            const body: unknown = await res.json().catch(() => null);
            setBusy(false);
            if (!isApiResponse(body) || !body.ok) {
              // A conflict leaves the sheet open so the admin can act on it.
              setDeactivateError(
                isApiResponse(body) && !body.ok ? body.error.message : "Could not deactivate.",
              );
              return;
            }
            setDeactivating(null);
            setNotice({ tone: "success", text: `${target.full_name} deactivated.` });
            await load();
          })();
        }}
      />
    </div>
  );
}

function Menu({
  member,
  busy,
  onEdit,
  onDeactivate,
  onReactivated,
  onError,
}: {
  member: MemberRow;
  busy: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivated: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${member.full_name}`}>
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit} disabled={busy}>
          Edit
        </DropdownMenuItem>
        {member.is_active ? (
          <DropdownMenuItem onClick={onDeactivate} disabled={busy}>
            Deactivate…
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={busy}
            onClick={() => {
              void (async () => {
                const res = await fetch(`/api/admin/members/${member.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  credentials: "same-origin",
                  body: JSON.stringify({ action: "reactivate" }),
                });
                const body: unknown = await res.json().catch(() => null);
                if (!isApiResponse(body) || !body.ok) {
                  onError(
                    isApiResponse(body) && !body.ok
                      ? body.error.message
                      : "Could not reactivate.",
                  );
                  return;
                }
                await onReactivated();
              })();
            }}
          >
            Reactivate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
