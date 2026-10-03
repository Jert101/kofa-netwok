import { describe, expect, it, vi } from "vitest";
import {
  REPORTS_BUCKET,
  buildReportPdfKey,
  discardReportPdf,
  isCanonicalBase64,
  isSafeObjectKey,
  readReportPdf,
  storeReportPdf,
} from "@/lib/reports/storage";

const PDF = Buffer.from("%PDF-1.4 fake report body");

/** Minimal stand-in for the two Supabase calls the storage module makes. */
type SupabaseErr = { message: string } | null;

/** Minimal stand-in for the two Supabase calls the storage module makes. */
function fakeClient(opts: { uploadError?: string | null; object?: Buffer | null; downloadError?: string | null }) {
  // Argument types are attached via vi.fn's function generic rather than by naming the
  // parameters in the implementation. Naming them would trip no-unused-vars, since this
  // repo's ESLint config sets no argsIgnorePattern, and omitting them would leave
  // `mock.calls[0]` typed as `[]` so the arguments could not be read back out.
  const upload = vi.fn<
    (key: string, body: Buffer, options: Record<string, unknown>) => Promise<{ error: SupabaseErr }>
  >(async () => ({ error: opts.uploadError ? { message: opts.uploadError } : null }));

  const remove = vi.fn<(keys: string[]) => Promise<{ error: SupabaseErr }>>(async () => ({
    error: null,
  }));

  const download = vi.fn<
    (key: string) => Promise<{ data: { arrayBuffer: () => Promise<ArrayBuffer> } | null; error: SupabaseErr }>
  >(async () => {
    if (opts.downloadError) return { data: null, error: { message: opts.downloadError } };
    const buf = opts.object ?? null;
    if (!buf) return { data: null, error: { message: "not found" } };
    return {
      data: {
        arrayBuffer: async () =>
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      },
      error: null,
    };
  });

  const bucket = { upload, remove, download };
  const from = vi.fn<(name: string) => typeof bucket>(() => bucket);

  return { client: { storage: { from } } as never, upload, remove, download, from };
}

describe("buildReportPdfKey", () => {
  it("keys by month and a unique filename", () => {
    const key = buildReportPdfKey("2026-09-01");
    expect(key).toMatch(/^reports\/2026-09\/[0-9a-f-]{36}\.pdf$/);
  });

  it("produces a distinct key every call, so concurrent generations cannot collide", () => {
    const keys = new Set(Array.from({ length: 200 }, () => buildReportPdfKey("2026-09-01")));
    expect(keys.size).toBe(200);
  });

  it("truncates a full timestamp to a year-month", () => {
    expect(buildReportPdfKey("2026-09-01T00:00:00.000Z")).toMatch(/^reports\/2026-09\//);
  });
});

describe("isSafeObjectKey", () => {
  it("accepts an ordinary key", () => {
    expect(isSafeObjectKey("reports/2026-09/abc.pdf")).toBe(true);
  });

  it("rejects traversal and absolute paths", () => {
    for (const k of ["../secrets.env", "reports/../../etc/passwd", "/etc/passwd", "a\\b"]) {
      expect(isSafeObjectKey(k), k).toBe(false);
    }
  });

  it("rejects control characters that would break response headers", () => {
    expect(isSafeObjectKey("reports/a\r\nX-Evil: 1.pdf")).toBe(false);
    expect(isSafeObjectKey("reports/a\u0000.pdf")).toBe(false);
  });

  it("rejects empty and absurdly long keys", () => {
    expect(isSafeObjectKey("")).toBe(false);
    expect(isSafeObjectKey("a".repeat(513))).toBe(false);
  });
});

describe("storeReportPdf", () => {
  it("uploads to the private bucket and records an object path", async () => {
    const { client, upload, from } = fakeClient({});
    const { stored, degraded } = await storeReportPdf(client, PDF, "2026-09-01");

    expect(from).toHaveBeenCalledWith(REPORTS_BUCKET);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(degraded).toBe(false);
    expect(stored.storageKind).toBe("object");
    if (stored.storageKind !== "object") return;
    expect(isSafeObjectKey(stored.path)).toBe(true);
    expect(stored.path.startsWith("reports/2026-09/")).toBe(true);
  });

  it("sends the PDF as application/pdf without upserting", async () => {
    const { client, upload } = fakeClient({});
    await storeReportPdf(client, PDF, "2026-09-01");
    const [, body, options] = upload.mock.calls[0];
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(options).toMatchObject({ contentType: "application/pdf", upsert: false });
  });

  it("falls back to inline when storage rejects the upload, and flags the degradation", async () => {
    const { client } = fakeClient({ uploadError: "bucket not found" });
    const { stored, degraded } = await storeReportPdf(client, PDF, "2026-09-01");

    expect(degraded).toBe(true);
    expect(stored.storageKind).toBe("inline");
    if (stored.storageKind !== "inline") return;
    // Must round-trip, not merely be present: a report whose PDF cannot be decoded is worse
    // than one that was never stored.
    expect(Buffer.from(stored.base64, "base64").equals(PDF)).toBe(true);
  });
});

describe("discardReportPdf", () => {
  it("removes the uploaded object when the reports insert failed", () => {
    const { client, remove } = fakeClient({});
    discardReportPdf(client, "reports/2026-09/abc.pdf");
    expect(remove).toHaveBeenCalledWith(["reports/2026-09/abc.pdf"]);
  });

  it("refuses to call remove on an unsafe key", () => {
    const { client, remove } = fakeClient({});
    discardReportPdf(client, "../../etc/passwd");
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("readReportPdf", () => {
  it("decodes an inline row", async () => {
    const { client, download } = fakeClient({});
    const b64 = PDF.toString("base64");
    const r = await readReportPdf(client, b64, "inline");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes.equals(PDF)).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  it("treats a null kind as inline, so pre-029 reports keep working", async () => {
    // The six existing reports have base64 in pdf_storage_path and no kind recorded.
    // Defaulting them to "object" would turn every one of them into a 500.
    const { client, download } = fakeClient({});
    const r = await readReportPdf(client, PDF.toString("base64"), null);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes.equals(PDF)).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  it("downloads an object row from the private bucket", async () => {
    const { client, download, from } = fakeClient({ object: PDF });
    const r = await readReportPdf(client, "reports/2026-09/abc.pdf", "object");

    expect(from).toHaveBeenCalledWith(REPORTS_BUCKET);
    expect(download).toHaveBeenCalledWith("reports/2026-09/abc.pdf");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes.equals(PDF)).toBe(true);
  });

  it("reports missing rather than throwing when there is no PDF", async () => {
    const { client } = fakeClient({});
    const r = await readReportPdf(client, null, "object");
    expect(r).toMatchObject({ ok: false, reason: "missing" });
  });

  it("refuses to download an unsafe path", async () => {
    const { client, download } = fakeClient({ object: PDF });
    const r = await readReportPdf(client, "../../../etc/passwd", "object");
    expect(r).toMatchObject({ ok: false, reason: "unsafe" });
    expect(download).not.toHaveBeenCalled();
  });

  it("surfaces a storage read failure instead of returning an empty PDF", async () => {
    const { client } = fakeClient({ downloadError: "Object not found" });
    const r = await readReportPdf(client, "reports/2026-09/gone.pdf", "object");
    expect(r).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("rejects undecodable inline data rather than serving a partial PDF", async () => {
    // Buffer.from(x, "base64") skips invalid characters and decodes the rest, so garbage in
    // yields non-empty junk. Serving that as .pdf gives the user a file that will not open.
    const { client } = fakeClient({});
    for (const bad of ["!!!not-base64!!!", "%%%%", "abc"]) {
      const r = await readReportPdf(client, bad, "inline");
      expect(r.ok, bad).toBe(false);
      if (r.ok) continue;
      expect(r.reason, bad).toBe("unreadable");
    }
  });

  it("rejects base64 that decodes to something other than a PDF", async () => {
    const notAPdf = Buffer.from("this is plain text, not a PDF").toString("base64");
    const { client } = fakeClient({});
    const r = await readReportPdf(client, notAPdf, "inline");
    expect(r).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("accepts base64 that has been line-wrapped by a database round trip", async () => {
    const wrapped = PDF.toString("base64").replace(/(.{8})/g, "$1\n");
    const { client } = fakeClient({});
    const r = await readReportPdf(client, wrapped, "inline");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes.equals(PDF)).toBe(true);
  });

  it("rejects a zero-length or non-PDF object", async () => {
    for (const obj of [Buffer.alloc(0), Buffer.from("<html>404</html>")]) {
      const { client } = fakeClient({ object: obj });
      const r = await readReportPdf(client, "reports/2026-09/x.pdf", "object");
      expect(r, String(obj.length)).toMatchObject({ ok: false, reason: "unreadable" });
    }
  });
});

describe("isCanonicalBase64", () => {
  it("accepts canonical base64", () => {
    expect(isCanonicalBase64(PDF.toString("base64"))).toBe(true);
  });

  it("tolerates embedded whitespace from column storage", () => {
    expect(isCanonicalBase64("QUJD\n  RUZH")).toBe(true);
  });

  it("rejects empty, mis-padded, and non-alphabet input", () => {
    for (const bad of ["", "   ", "abc", "AB=C", "!!!!", "QUJD*"]) {
      expect(isCanonicalBase64(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
