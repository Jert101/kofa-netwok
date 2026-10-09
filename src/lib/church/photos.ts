/**
 * Photographs for the parish profile and the council.
 *
 * Everything here is about one fact: **these images are served publicly.** They are read by anyone who
 * opens the landing page, from a public bucket, at a guessable-enough URL that a browser will cache and
 * a stranger can share. That is the intent -- they are pictures of the priest and of council members,
 * published on purpose -- but it means the bytes are not something to accept on the browser's word.
 *
 * Two checks, both here rather than in the route:
 *
 * - **Magic bytes, not the declared type.** `file.type` is whatever the browser felt like reporting, and
 *   the route that receives it is exactly where a renamed executable or a script dressed as an image
 *   would arrive. The first bytes are what the bytes actually are.
 * - **An allowlist, not a blocklist.** JPEG, PNG and WebP. SVG is excluded deliberately rather than
 *   forgotten: it is a document that can carry script, it is not a photograph, and no parish office
 *   needs it here.
 */

/** The bucket. Public: these images are published, by design. */
export const PHOTO_BUCKET = "church-photos";

/** Matches the bucket's `file_size_limit`. A portrait for a web page is not a 5 MB photograph. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export type PhotoType = "image/jpeg" | "image/png" | "image/webp";

export type PhotoScope = "priest" | "council";

/** The extension each type is stored under. Not the type's own subtype spelling. */
const EXTENSION: Record<PhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** What a person is told, which is more useful than "invalid image". */
const TYPE_LABEL: Record<PhotoType, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
};

/**
 * What the first bytes say the image is.
 *
 * Compares only as many bytes as each signature needs, so a short or empty file is not read past its
 * end. Returns null for anything not on the list, which is the answer that matters: an unrecognised
 * signature is refused, not guessed at.
 */
export function sniffImageType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG's signature is eight bytes and is specific enough that all eight are checked.
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP is a RIFF container, so the signature is the container tag plus the form type at byte 8.
  // Checking only "RIFF" would accept any RIFF file, including a WAV.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Why this file cannot be used, or what it is.
 *
 * Size is checked before type because a 40 MB file is the more common mistake and the cheaper message,
 * and because reading the whole of one into memory to then refuse it is worth avoiding.
 */
export function validatePhoto(bytes: Uint8Array): { ok: true; type: PhotoType } | { ok: false; message: string } {
  if (bytes.length === 0) {
    return { ok: false, message: "That file is empty." };
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    const mb = (bytes.length / (1024 * 1024)).toFixed(1);
    return { ok: false, message: `That photo is ${mb} MB. Please use one under 2 MB.` };
  }
  const type = sniffImageType(bytes);
  if (!type) {
    return {
      ok: false,
      message: "That file is not a JPEG, PNG or WebP image. Please choose a photograph in one of those formats.",
    };
  }
  return { ok: true, type };
}

/**
 * The key an upload is stored under.
 *
 * A uuid, never the person's name. A filename like `fr-john-santos.jpg` in a public bucket is both a
 * directory listing away from anything else the parish uploads, and a name that outlives the office --
 * the next priest's photograph would have to be given a different name for no reason.
 */
export function buildPhotoKey(scope: PhotoScope, type: PhotoType): string {
  const uid = globalThis.crypto.randomUUID();
  return `${scope}/${uid}.${EXTENSION[type]}`;
}

/** The public URL for a stored key. */
export function publicPhotoUrl(key: string, supabaseUrl: string | undefined | null): string | null {
  const base = (supabaseUrl ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${key}`;
}

/**
 * The key inside a stored photo URL, or null when the URL is not one of ours.
 *
 * Used to delete the previous photograph when it is replaced. A URL that does not match is refused rather
 * than parsed: this value came out of the database and is about to become part of a `remove()` call, and
 * "anything that does not look exactly like our bucket is not ours" is the rule that keeps a bad value
 * from removing something else.
 */
export function keyFromPhotoUrl(url: string | null | undefined, supabaseUrl: string | undefined | null): string | null {
  if (!url) return null;
  const base = (supabaseUrl ?? "").replace(/\/$/, "");
  if (!base) return null;
  const prefix = `${base}/storage/v1/object/public/${PHOTO_BUCKET}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  // No traversal, no leading slash, and only the two scope folders this module writes.
  if (key.length === 0 || key.length > 512) return null;
  if (key.includes("..") || key.includes("\\") || key.includes("//")) return null;
  if (/[\u0000-\u001f]/.test(key)) return null;
  if (!/^(priest|council)\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(key)) return null;
  return key;
}

/** Human-readable byte size, for the "too big" message on the client where there is no route yet. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { EXTENSION as PHOTO_EXTENSION, TYPE_LABEL as PHOTO_TYPE_LABEL };