"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SmsRow = {
  id: string;
  recipient: string;
  member_id: string | null;
  message: string;
  type: string;
  priority: number;
  status: "pending" | "sent" | "failed";
  retries: number;
  max_retries: number;
  dedupe_key: string;
  created_at: string;
  sent_at: string | null;
  error: string | null;
};

type SmsResponse = {
  ok: boolean;
  queue: SmsRow[];
  sentToday: number;
  dailyLimit: number;
};

function when(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function statusBadge(status: string) {
  const base = "px-2 py-0.5 rounded text-xs font-medium";
  if (status === "sent") return <span className={`${base} bg-green-100 text-green-700`}>Sent</span>;
  if (status === "failed") return <span className={`${base} bg-red-100 text-red-700`}>Failed</span>;
  return <span className={`${base} bg-amber-100 text-amber-700`}>Pending</span>;
}

export default function SmsQueuePage() {
  const [queue, setQueue] = useState<SmsRow[]>([]);
  const [sentToday, setSentToday] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [filter, setFilter] = useState<"all" | "pending" | "sent" | "failed">("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (f: "all" | "pending" | "sent" | "failed" = "all") => {
      setError(null);
      try {
        const res = await fetch(
          `/api/sms?status=${f === "all" ? "" : f}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!res.ok) throw new Error("Could not load the text queue.");
        const j = (await res.json()) as SmsResponse;
        setQueue(j.queue);
        setSentToday(j.sentToday ?? 0);
        setDailyLimit(j.dailyLimit ?? 50);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the text queue.");
        setQueue([]);
      }
    },
    [],
  );

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  const filtered = queue.filter((r) => filter === "all" || r.status === filter);

  const remaining = Math.max(dailyLimit - sentToday, 0);

  const retry = async (row: SmsRow) => {
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: row.message,
          type: row.type,
          recipient: row.recipient,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Could not retry that message.");
        return;
      }
      // Mark this row as retried: reload so the status reflects reality.
      void load(filter);
    } catch {
      setError("Could not reach the server, so nothing was retried.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Text messages</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Outgoing text messages through the parish phone. A message stays pending until textbee
            delivers it, then moves to sent or failed.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
          <span className="font-medium">Today</span>
          <span className={`font-mono tabular-nums ${remaining <= 5 ? "text-red-700 font-bold" : ""}`}>
            {sentToday}
          </span>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="font-mono tabular-nums">{dailyLimit}</span>
          <span className="text-xs text-[var(--text-muted)]">sent</span>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <div className="flex gap-2">
        {["all", "pending", "sent", "failed"].map((value) => {
          const label = value === "all" ? "All" : value.charAt(0).toUpperCase() + value.slice(1);
          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value as typeof filter)}
            >
              {label}
            </Button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No text messages {filter === "all" ? "" : filter}.{" "}
            {filter === "pending" && remaining > 0 ? "They will be sent automatically." : ""}
          </p>
        ) : null}

        {filtered.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-16">Pri.</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead className="w-12">Tries</TableHead>
                <TableHead className="w-24">Created</TableHead>
                <TableHead className="w-28">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.recipient}</TableCell>
                  <TableCell className="max-w-[34rem] truncate">{row.message}</TableCell>
                  <TableCell className="text-xs text-[var(--text-muted)]">{row.type}</TableCell>
                  <TableCell className="text-xs font-mono tabular-nums">{row.priority}</TableCell>
                  <TableCell>{statusBadge(row.status)}</TableCell>
                  <TableCell className="text-xs font-mono tabular-nums">
                    {row.retries}/{row.max_retries}
                  </TableCell>
                  <TableCell className="text-xs text-[var(--text-muted)]">{when(row.created_at)}</TableCell>
                  <TableCell>
                    {row.status === "failed" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === row.id}
                        onClick={() => retry(row)}
                      >
                        {busy === row.id ? "Retrying…" : "Retry"}
                      </Button>
                    ) : (
                      row.error ? <span className="text-xs text-[var(--text-muted)]">{row.error}</span> : null
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>
    </div>
  );
}
