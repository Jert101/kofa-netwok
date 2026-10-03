import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PDF storage for monthly reports.
 *
 * Migration 029 added `pdf_storage_kind` to `reports` because the old column conflated two
 * different things: for a v4 row `pdf_storage_path` holds base64 PDF bytes, and every reader
 * decoded it as such. There is no way to tell the two apart from the path alone, so new
 * reports record which they are and readers branch on the explicit column.
 *
 *   "inline" - `pdf_storage_path` is base64 in the reports row. The 6 reports generated
 *              before 029 are all like this and stay that way; rewriting them would mean
 *              re-rendering six PDFs for no user-visible gain.
 *   "object" - `pdf_storage_path` is a key inside the private `reports` storage bucket.
 *              New reports use this, because a month of attendance as base64 roughly
 *              quarters the row and any future SELECT that touches the reports table pays
 *              for every PDF it did not ask for.
 */
export const REPORTS_BUCKET = "reports";

export type PdfStorageKind = "inline" | "object";

export type StoredPdf =
  | { storageKind: "object"; path: string }
  | { storageKind: "inline"; base64: string };

/**
 * Storage keys are opaque to us, but a key is still attacker-influenced input by the time it
 * reaches `download()`. Anything that could walk out of the bucket prefix is rejected rather
 * than normalised, so a bad value is a 500 we can trace rather than a file we cannot.
 */
export function isSafeObjectKey(key: string): boolean {
  if (!key || key.length > 512) return false;
  if (key.includes("..")) return false;
  if (key.startsWith("/") || key.includes("\\")) return false;
  if (/[\u0000-\u001f]/.test(key)) return false;
  return true;
}

/**
 * Storage key for a report's PDF.
 *
 * The report id is not available yet at generation time — the row has to be inserted after
 * the PDF is rendered — so the key is built from the month plus a client-generated uuid
 * rather than the id. That keeps the key stable and unique without a second write, and means
 * a failed insert can be cleaned up by deleting exactly the key we just uploaded.
 */
export function buildReportPdfKey(monthStart: string): string {
  const month = monthStart.slice(0, 7);
  const uid = globalThis.crypto.randomUUID();
  return `reports/${month}/${uid}.pdf`;
}

/**
 * Persist a rendered PDF, preferring the private bucket and falling back to inline.
 *
 * Falling back is deliberate. Storage being unavailable is an infrastructure problem, and
 * failing the whole generation over it would throw away a PDF that has already been rendered
 * correctly — the secretary would get an error for a report that exists on disk and cannot
 * be recovered. Inline is a worse home for the bytes but still a working download, and
 * `pdf_storage_kind` records honestly which happened so nothing downstream has to guess.
 */
export async function storeReportPdf(
  sb: SupabaseClient,
  bytes: Buffer,
  monthStart: string,
): Promise<{ stored: StoredPdf; degraded: boolean }> {
  const key = buildReportPdfKey(monthStart);

  const { error } = await sb.storage
    .from(REPORTS_BUCKET)
    .upload(key, bytes, { contentType: "application/pdf", upsert: false });

  if (!error) {
    return { stored: { storageKind: "object", path: key }, degraded: false };
  }

  return {
    stored: { storageKind: "inline", base64: Buffer.from(bytes).toString("base64") },
    degraded: true,
  };
}

/**
 * Best-effort removal of an orphaned object.
 *
 * Called when the reports insert fails after a successful upload. Not awaited by callers that
 * are already returning an error: the user is waiting, and a leaked object in a private
 * bucket is a storage-cost problem, not a correctness one.
 */
export function discardReportPdf(sb: SupabaseClient, key: string): void {
  if (!isSafeObjectKey(key)) return;
  void sb.storage.from(REPORTS_BUCKET).remove([key]).catch(() => {});
}

/**
 * Base64 syntax check.
 *
 * `Buffer.from(value, "base64")` does not throw on bad input — Node discards characters
 * outside the alphabet and decodes whatever is left, so a corrupt or truncated value yields
 * a short buffer rather than an error. Checking the syntax first is the only way to tell
 * "this is a small PDF" from "this was not base64 at all".
 */
export function isCanonicalBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (compact.length === 0 || compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

/**
 * Read a report's PDF bytes, branching on the recorded kind.
 *
 * `kind` is passed by the caller rather than re-read here so the caller can decide what a
 * missing or unknown value means (404 vs 500) with knowledge of the row's status.
 */
export async function readReportPdf(
  sb: SupabaseClient,
  value: string | null,
  kind: string | null,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: "missing" | "unsafe" | "unreadable"; message: string }> {
  if (!value) return { ok: false, reason: "missing", message: "No PDF stored for this report." };

  // A row with a path but no recorded kind predates 029 and must be read as base64. The
  // default matters: treating it as an object key would break all six existing reports.
  const effective: PdfStorageKind = kind === "object" ? "object" : "inline";

  if (effective === "inline") {
    if (!isCanonicalBase64(value)) {
      return { ok: false, reason: "unreadable", message: "Stored PDF data is not valid base64." };
    }
    const bytes = Buffer.from(value, "base64");
    if (!looksLikePdf(bytes)) {
      return { ok: false, reason: "unreadable", message: "Stored PDF data is not a PDF." };
    }
    return { ok: true, bytes };
  }

  if (!isSafeObjectKey(value)) {
    return { ok: false, reason: "unsafe", message: "Stored PDF path is not valid." };
  }

  const { data, error } = await sb.storage.from(REPORTS_BUCKET).download(value);
  if (error || !data) {
    return { ok: false, reason: "unreadable", message: "Stored PDF could not be read." };
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    return { ok: false, reason: "unreadable", message: "Stored PDF is empty or not a PDF." };
  }
  return { ok: true, bytes };
}

/** Every PDF starts with this; anything else means the bytes are not what the column claims. */
function looksLikePdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}
