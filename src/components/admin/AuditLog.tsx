"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isApiResponse } from "@/lib/api/response";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import { ROLE_LABEL } from "@/lib/nav/config";
import { ROLE_ORDER } from "@/lib/auth/roles";

type AuditRow = {
  id: string;
  at: string;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
};

type Result = { items: AuditRow[]; total: number; page: number; pageSize: number };

const WINDOW_PRESETS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;

const HIGHLIGHTED = new Set<AuditAction>([
  "login_failed",
  "pin_changed",
  "sessions_revoked",
  "registration_rejected",
  "payment_voided",
  "report_rejected",
  "settings_updated",
  "backup_downloaded",
]);

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function actionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action;
}

function summarizeMeta(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const entries = Object.entries(meta).slice(0, 4);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(" · ");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.length === 0 ? "none" : `${value.length}`;
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export function AuditLog() {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState("all");
  const [action, setAction] = useState("all");
  const [windowDays, setWindowDays] = useState("30");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (role !== "all") params.set("role", role);
    if (action !== "all") params.set("action", action);
    if (windowDays !== "all") params.set("from", isoDaysAgo(Number(windowDays)));
    if (search) params.set("q", search);
    return params.toString();
  }, [page, role, action, windowDays, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/audit?${queryString}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body: unknown = await res.json();
      if (isApiResponse<Result>(body) && body.ok) {
        setData(body.data);
        setError(null);
      } else {
        setError(
          isApiResponse(body) && !body.ok ? body.error.message : "Could not load the audit log.",
        );
      }
    } catch {
      setError("Can't reach the server.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter change starts the result set over.
  useEffect(() => {
    setPage(1);
  }, [role, action, windowDays, search]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const csvHref = `/api/admin/audit/csv?${queryString.replace(/^page=\d+/, "page=1")}`;

  function reset() {
    setRole("all");
    setAction("all");
    setWindowDays("30");
    setQ("");
    setSearch("");
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <Card className="border-[var(--border)] bg-[var(--surface)]">
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="audit-role" className="text-xs text-[var(--text-muted)]">
                Role
              </label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="audit-role" className="mt-1 h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {ROLE_ORDER.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="audit-action" className="text-xs text-[var(--text-muted)]">
                Action
              </label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger id="audit-action" className="mt-1 h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {AUDIT_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUDIT_ACTION_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="audit-window" className="text-xs text-[var(--text-muted)]">
                When
              </label>
              <Select value={windowDays} onValueChange={setWindowDays}>
                <SelectTrigger id="audit-window" className="mt-1 h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_PRESETS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
            className="flex gap-2"
          >
            <Input
              className="h-12 flex-1"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search actor name or action"
              aria-label="Search actor name or action"
            />
            <Button type="submit" variant="secondary" className="h-12">
              <Search aria-hidden className="size-4" />
              Search
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-12"
              onClick={() => {
                setQ("");
                setSearch("");
              }}
              aria-label="Clear search"
            >
              <X aria-hidden className="size-4" />
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
            <span>
              {data ? `${data.total} event${data.total === 1 ? "" : "s"}` : "…"} · page {page} of{" "}
              {totalPages}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                Clear filters
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={csvHref} download>
                  <Download aria-hidden className="size-4" />
                  Export CSV
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        {loading && !data ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">Loading…</p>
        ) : data && data.items.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">
            No events match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {data?.items.map((row) => (
              <li key={row.id} className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={HIGHLIGHTED.has(row.action as AuditAction) ? "destructive" : "secondary"}
                      className="font-normal"
                    >
                      {actionLabel(row.action)}
                    </Badge>
                    <span className="text-sm text-[var(--text)]">
                      {row.actor_name ?? "Unknown actor"}
                    </span>
                    {row.actor_role ? (
                      <span className="text-xs text-[var(--text-muted)]">
                        {ROLE_LABEL[row.actor_role as keyof typeof ROLE_LABEL] ?? row.actor_role}
                      </span>
                    ) : null}
                  </div>
                  <time dateTime={row.at} className="text-xs text-[var(--text-muted)]">
                    {formatTimestamp(row.at)}
                  </time>
                </div>
                {row.entity_type ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {row.entity_type}
                    {row.entity_id ? ` · ${row.entity_id}` : ""}
                  </p>
                ) : null}
                {summarizeMeta(row.meta) ? (
                  <p className="mt-1 break-words text-xs text-[var(--text-muted)]">
                    {summarizeMeta(row.meta)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Newer
        </Button>
        <span className="text-xs text-[var(--text-muted)]">
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Older
        </Button>
      </div>
    </div>
  );
}
