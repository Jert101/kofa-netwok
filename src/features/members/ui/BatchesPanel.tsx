"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isApiResponse } from "@/lib/api/response";
import { batchInUseMessage, isBatchInUse, type BatchRow } from "@/features/members/batches";

type Batch = BatchRow;

export type BatchesPanelProps = {
  /** Called after any change so the directory filter list stays in step. */
  onChanged?: () => void;
};

export function BatchesPanel({ onChanged }: BatchesPanelProps) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Batch | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/member-batches", { credentials: "same-origin" });
    const body: unknown = await res.json().catch(() => null);
    if (isApiResponse<{ batches: Batch[] }>(body) && body.ok) {
      setBatches(body.data.batches);
      return;
    }
    setBatches([]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addYear() {
    if (!/^\d{4}$/.test(year.trim())) {
      setError("Use a four digit year.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/admin/member-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ year: year.trim() }),
    });
    const body: unknown = await res.json().catch(() => null);
    setBusy(false);
    if (!isApiResponse<{ created: boolean }>(body) || !body.ok) {
      setError(
        isApiResponse(body) && !body.ok
          ? (Object.values(body.error.fields ?? {})[0] ?? body.error.message)
          : "Could not add that year.",
      );
      return;
    }
    setYear("");
    setNotice(body.data.created ? `${year.trim()} added.` : "That year already existed.");
    await load();
    onChanged?.();
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setBlocked(null);
    const res = await fetch("/api/admin/member-batches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id: removing.id }),
    });
    const body: unknown = await res.json().catch(() => null);
    setBusy(false);
    if (!isApiResponse(body) || !body.ok) {
      // MEM-6: the year is in use, so the message says who is using it.
      setBlocked(
        isApiResponse(body) && !body.ok ? body.error.message : "Could not remove that year.",
      );
      return;
    }
    setNotice(`${removing.year} removed.`);
    setRemoving(null);
    await load();
    onChanged?.();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="batch-year">Add a batch year</Label>
          <Input
            id="batch-year"
            inputMode="numeric"
            maxLength={4}
            placeholder="2026"
            className="w-28"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <Button onClick={addYear} disabled={busy || year.length !== 4}>
          <Plus aria-hidden className="size-4" />
          Add
        </Button>
        <p className="text-xs text-[var(--muted)]">
          Batches are used by registration and by the payments scope.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {blocked ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {blocked}
        </p>
      ) : null}

      {batches === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : batches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
          No batch years yet.
        </p>
      ) : (
        <div className="rounded-xl border border-[var(--border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Members</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.year}</TableCell>
                  <TableCell>{b.member_count}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${b.year}`}
                      disabled={busy}
                      onClick={() => {
                        setBlocked(null);
                        setRemoving(b);
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setBlocked(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove batch {removing?.year}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && isBatchInUse(removing)
                ? batchInUseMessage(
                    removing.year,
                    removing.member_count,
                    removing.structure_count ?? 0,
                  )
                : "Nobody is in this batch, so it can be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void remove();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
