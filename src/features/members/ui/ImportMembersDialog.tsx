"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  BadgeCheck,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { isApiResponse } from "@/lib/api/response";
import {
  errorReportCsv,
  importTemplateCsv,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ImportRow,
} from "@/features/members/import-csv";
import type { ImportPreview, ImportResult } from "@/features/members/server/import-members";

function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_LABEL: Record<ImportRow["status"], string> = {
  ok: "Ready",
  duplicate: "Duplicate",
  error: "Check row",
};

function statusClasses(status: ImportRow["status"]) {
  if (status === "ok") return "bg-[var(--success-soft)] text-[var(--success)]";
  if (status === "duplicate") return "bg-[var(--warn-soft)] text-[var(--warn)]";
  return "bg-[var(--danger-soft)] text-[var(--danger)]";
}

/**
 * MEM-5: bringing in a parish list from a spreadsheet.
 *
 * The flow is check, then commit. Nothing is written until the admin has seen
 * which rows are ready, which are already on the roll, and which need fixing, and
 * ticked the box. Duplicates are never imported silently.
 */
export function ImportMembersDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [createBatches, setCreateBatches] = useState(false);
  const [busy, setBusy] = useState<"check" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCsv("");
      setFileName("");
      setPreview(null);
      setResult(null);
      setCreateBatches(false);
      setError(null);
      setBusy(null);
    }
  }, [open]);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setPreview(null);

    if (file.size > MAX_IMPORT_BYTES) {
      setError("That file is larger than 1 MB. Split it into smaller files.");
      return;
    }
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setError("Choose a .csv file.");
      return;
    }

    setFileName(file.name);
    setCsv(await file.text());
  }

  async function post(mode: "preview" | "commit") {
    const res = await fetch(
      `/api/admin/members/import${mode === "commit" ? "?mode=commit" : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, createMissingBatches: createBatches }),
      },
    );
    return { res, body: (await res.json()) as unknown };
  }

  async function check() {
    setBusy("check");
    setError(null);
    try {
      const { res, body } = await post("preview");
      if (!res.ok || !isApiResponse<ImportPreview>(body) || !body.ok) {
        setError("Could not read that file.");
        return;
      }
      setPreview(body.data);
      if (body.data.counts.error > 0) {
        toast.warning(`${body.data.counts.error} row(s) need fixing before importing.`);
      }
    } catch {
      setError("Could not read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    setBusy("commit");
    setError(null);
    try {
      const { res, body } = await post("commit");
      if (!res.ok || !isApiResponse<ImportResult>(body) || !body.ok) {
        setError("The import did not finish. Nothing was changed.");
        return;
      }
      setResult(body.data);
      setPreview(null);
      setCsv("");
      setFileName("");
      if (body.data.counts.imported > 0) {
        toast.success(`Imported ${body.data.counts.imported} member(s).`);
        onImported();
      }
    } catch {
      setError("The import did not finish. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  const ready = preview?.counts.ok ?? 0;
  const canImport = ready > 0 && !busy;
  const blockedByUnknownBatch = (preview?.unknownBatches.length ?? 0) > 0 && !createBatches;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import members from a file</DialogTitle>
          <DialogDescription>
            One member per row, up to {MAX_IMPORT_ROWS} rows. Names already on the roll
            are skipped, and every row is checked before anything is written.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => download("member-import-template.csv", importTemplateCsv())}
            >
              <Download aria-hidden /> Template
            </Button>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden /> Choose file
            </Button>

            {fileName ? (
              <span className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                <FileSpreadsheet aria-hidden className="size-4" />
                {fileName}
              </span>
            ) : null}

            {csv && !preview && !result ? (
              <Button
                type="button"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => void check()}
              >
                {busy === "check" ? <Loader2 aria-hidden className="animate-spin" /> : null}
                Check file
              </Button>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <BadgeCheck aria-hidden className="size-4 text-[var(--success)]" />
                <span>
                  <strong>{ready}</strong> ready
                </span>
                {preview.counts.duplicate > 0 ? (
                  <span className="text-[var(--warn)]">
                    {preview.counts.duplicate} duplicate
                  </span>
                ) : null}
                {preview.counts.error > 0 ? (
                  <span className="text-[var(--danger)]">
                    {preview.counts.error} need fixing
                  </span>
                ) : null}
              </div>

              {preview.truncated ? (
                <p className="rounded-lg bg-[var(--warn-soft)] p-3 text-sm text-[var(--warn)]">
                  Only the first {MAX_IMPORT_ROWS} rows were read. Anything after that was
                  left out. Split the file and import the rest separately.
                </p>
              ) : null}

              {preview.unknownBatches.length > 0 ? (
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-sm">
                    This file names{" "}
                    <strong>{preview.unknownBatches.join(", ")}</strong>, which is not a
                    batch yet.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Switch
                      id="create-missing-batches"
                      checked={createBatches}
                      onCheckedChange={setCreateBatches}
                    />
                    <Label htmlFor="create-missing-batches">
                      Create {preview.unknownBatches.join(" and ")}
                    </Label>
                  </div>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                <table className="w-full text-sm">
                  <caption className="sr-only">Rows found in the file</caption>
                  <thead className="bg-[var(--surface-2)] text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Line</th>
                      <th scope="col" className="px-3 py-2 font-medium">Name</th>
                      <th scope="col" className="px-3 py-2 font-medium">Batch</th>
                      <th scope="col" className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.line} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                          {row.line}
                        </td>
                        <td className="px-3 py-2">
                          {row.full_name || (
                            <span className="text-[var(--muted)]">
                              {row.values.first_name || "?"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                          {row.values.batch || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(row.status)}`}
                          >
                            {STATUS_LABEL[row.status]}
                          </span>
                          {row.message ? (
                            <p className="mt-0.5 text-xs text-[var(--muted)]">{row.message}</p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--border)] p-3 text-sm">
                <p>
                  Imported <strong>{result.counts.imported}</strong> member(s).
                </p>
                {result.counts.duplicate > 0 ? (
                  <p className="text-[var(--warn)]">
                    {result.counts.duplicate} row(s) were already on the roll and were
                    skipped.
                  </p>
                ) : null}
                {result.counts.invalid > 0 ? (
                  <p className="text-[var(--danger)]">
                    {result.counts.invalid} row(s) had errors and were not imported.
                  </p>
                ) : null}
              </div>
              {result.failed.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => download("member-import-errors.csv", errorReportCsv(result.failed))}
                >
                  <Download aria-hidden /> Download the {result.failed.length} skipped row(s)
                </Button>
              ) : null}
            </div>
          ) : null}

          <p className="flex items-start gap-2 text-xs text-[var(--muted)]">
            <Copy aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Columns: first_name, last_name, middle_initial, date_of_birth, gender,
            contact_number, batch. Only first_name and last_name are required. Dates
            take YYYY-MM-DD or MM/DD/YYYY. Gender takes male, female or other.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={Boolean(busy)}
          >
            {result ? "Close" : "Cancel"}
          </Button>
          {preview && !result ? (
            <>
              {preview.counts.error > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    download("member-import-errors.csv", errorReportCsv(preview.rows))
                  }
                >
                  <Download aria-hidden /> Download the errors
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={!canImport || blockedByUnknownBatch}
                onClick={() => void commit()}
              >
                {busy === "commit" ? <Loader2 aria-hidden className="animate-spin" /> : null}
                Import {ready} member{ready === 1 ? "" : "s"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
