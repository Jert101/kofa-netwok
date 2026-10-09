import { describe, expect, it } from "vitest";

import {
  MAX_PHOTO_BYTES,
  buildPhotoKey,
  discardPhotoObject,
  formatBytes,
  keyFromPhotoUrl,
  publicPhotoUrl,
  sniffImageType,
  validatePhoto,
} from "./photos";

const SUPA = "https://abc.supabase.co";

/** The real opening bytes of each format. The rest of the file is irrelevant to sniffing. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
]);
/** A RIFF container that is not WebP -- a WAV, which starts with the same four bytes. */
const WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66,
]);
const SVG = new Uint8Array([0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0x73, 0x76, 0x67]);
const EMPTY = new Uint8Array(0);

describe("sniffImageType", () => {
  it("recognises the three formats that are allowed", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("refuses a RIFF container that is not WebP", () => {
    // "RIFF" alone is not a signature; the form type at byte 8 is what makes it WebP. Checking only
    // the first four bytes would put every WAV file into the photo bucket.
    expect(sniffImageType(WAV)).toBeNull();
  });

  it("refuses SVG", () => {
    // A document that can carry script, and not a photograph.
    expect(sniffImageType(SVG)).toBeNull();
  });

  it("refuses an empty file rather than reading past its end", () => {
    expect(sniffImageType(EMPTY)).toBeNull();
  });

  it("refuses a file too short to hold a signature", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it("refuses an executable renamed to .jpg", () => {
    expect(sniffImageType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });
});

describe("validatePhoto", () => {
  it("accepts a real image", () => {
    expect(validatePhoto(PNG)).toEqual({ ok: true, type: "image/png" });
  });

  it("says the file is empty rather than calling it a bad format", () => {
    // Two different problems and two different fixes; conflating them sends somebody to re-export.
    expect(validatePhoto(EMPTY)).toEqual({ ok: false, message: "That file is empty." });
  });

  it("reports the actual size when it is too big", () => {
    const huge = new Uint8Array(MAX_PHOTO_BYTES + 1024);
    huge.set(PNG, 0);
    const result = validatePhoto(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/2 MB/);
  });

  it("checks size before type, so a huge wrong file is reported as huge", () => {
    // Reading 40 MB to then say "wrong format" wastes the officer's time and the server's memory.
    const huge = new Uint8Array(MAX_PHOTO_BYTES + 1);
    const result = validatePhoto(huge);
    if (!result.ok) expect(result.message).toMatch(/MB/);
  });

  it("accepts a file exactly at the limit", () => {
    const exact = new Uint8Array(MAX_PHOTO_BYTES);
    exact.set(PNG, 0);
    expect(validatePhoto(exact).ok).toBe(true);
  });

  it("names the formats it will accept", () => {
    const result = validatePhoto(SVG);
    if (!result.ok) expect(result.message).toMatch(/JPEG, PNG or WebP/);
  });
});

describe("buildPhotoKey", () => {
  it("uses a uuid, never the person's name", () => {
    // A filename in a public bucket is a directory listing away from the parish's other uploads, and a
    // name that outlives the office: the next priest would need a different filename for no reason.
    // The scope folder is ours and stays; nothing derived from the person does.
    const key = buildPhotoKey("priest", "image/jpeg");
    expect(key).toMatch(/^priest\/[0-9a-f-]{36}\.jpg$/);
    expect(key.split("/")[1].replace(/\.[a-z]+$/, "")).not.toMatch(/santos|juan|maria/i);
  });

  it("separates the two scopes", () => {
    expect(buildPhotoKey("council", "image/png")).toMatch(/^council\//);
    expect(buildPhotoKey("priest", "image/png")).toMatch(/^priest\//);
  });

  it("stores each format under its own extension", () => {
    expect(buildPhotoKey("council", "image/jpeg")).toMatch(/\.jpg$/);
    expect(buildPhotoKey("council", "image/png")).toMatch(/\.png$/);
    expect(buildPhotoKey("council", "image/webp")).toMatch(/\.webp$/);
  });

  it("does not repeat a key, so a replacement does not overwrite", () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => buildPhotoKey("council", "image/png")),
    );
    expect(keys.size).toBe(50);
  });
});

describe("publicPhotoUrl", () => {
  it("builds the public object URL", () => {
    expect(publicPhotoUrl("council/abc.png", SUPA)).toBe(
      `${SUPA}/storage/v1/object/public/church-photos/council/abc.png`,
    );
  });

  it("tolerates a trailing slash on the project URL", () => {
    expect(publicPhotoUrl("priest/a.png", `${SUPA}/`)).toBe(
      `${SUPA}/storage/v1/object/public/church-photos/priest/a.png`,
    );
  });

  it("returns null rather than a broken URL when the project URL is unknown", () => {
    // A relative "/storage/..." would render as a request to our own domain and 404.
    expect(publicPhotoUrl("priest/a.png", null)).toBeNull();
    expect(publicPhotoUrl("priest/a.png", "")).toBeNull();
  });
});

describe("keyFromPhotoUrl", () => {
  const url = (key: string) => publicPhotoUrl(key, SUPA)!;

  it("round-trips a URL we wrote", () => {
    expect(keyFromPhotoUrl(url("council/11111111-1111-1111-1111-111111111111.png"), SUPA)).toBe(
      "council/11111111-1111-1111-1111-111111111111.png",
    );
  });

  it("refuses a URL from somewhere else", () => {
    // This value reaches a remove() call. Anything not exactly our bucket is not ours to delete.
    expect(keyFromPhotoUrl("https://evil.example/x.png", SUPA)).toBeNull();
    expect(keyFromPhotoUrl(`${SUPA}/storage/v1/object/public/other/priest/a.png`, SUPA)).toBeNull();
  });

  it("refuses a URL built for a different project", () => {
    expect(keyFromPhotoUrl(url("priest/a.png"), "https://other.supabase.co")).toBeNull();
  });

  it("refuses traversal and odd characters", () => {
    expect(keyFromPhotoUrl(url("council/../../../etc/passwd"), SUPA)).toBeNull();
    expect(keyFromPhotoUrl(url("council/..\\..\\x.png"), SUPA)).toBeNull();
  });

  it("refuses a key in a folder this module never writes to", () => {
    expect(keyFromPhotoUrl(url("reports/2026/x.pdf"), SUPA)).toBeNull();
    expect(keyFromPhotoUrl(url("anything/at-all.png"), SUPA)).toBeNull();
  });

  it("refuses a key that is not the shape we write", () => {
    expect(keyFromPhotoUrl(url("council/not-a-uuid.png"), SUPA)).toBeNull();
    expect(keyFromPhotoUrl(url("council/11111111-1111-1111-1111-111111111111.svg"), SUPA)).toBeNull();
  });

  it("returns null for nothing", () => {
    expect(keyFromPhotoUrl(null, SUPA)).toBeNull();
    expect(keyFromPhotoUrl("", SUPA)).toBeNull();
    expect(keyFromPhotoUrl(url("priest/a.png"), null)).toBeNull();
  });
});

describe("formatBytes", () => {
  it("reads as a person would write it", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_500_000)).toBe("1.4 MB");
  });
});

describe("discardPhotoObject", () => {
  /** Records what it was asked to delete instead of deleting anything. */
  function stubStorage(error: { message: string } | null = null) {
    const removed: string[][] = [];
    return {
      removed,
      sb: {
        storage: {
          from: () => ({
            remove: async (paths: string[]) => {
              removed.push(paths);
              return { error };
            },
          }),
        },
      },
    };
  }

  const uuid = "11111111-2222-3333-4444-555555555555";

  it("deletes the object behind a URL of ours", async () => {
    const s = stubStorage();
    const url = `${SUPA}/storage/v1/object/public/church-photos/priest/${uuid}.jpg`;
    const result = await discardPhotoObject(s.sb, url, SUPA);
    expect(result).toEqual({ ok: true, removed: true });
    expect(s.removed).toEqual([[`priest/${uuid}.jpg`]]);
  });

  it("deletes nothing when there is no photograph", async () => {
    // The common case by far: most council members have no picture, so every clear of a name or a bio
    // must not reach for storage at all.
    const s = stubStorage();
    expect(await discardPhotoObject(s.sb, null, SUPA)).toEqual({ ok: true, removed: false });
    expect(await discardPhotoObject(s.sb, undefined, SUPA)).toEqual({ ok: true, removed: false });
    expect(s.removed).toEqual([]);
  });

  it("does not delete something that is not ours", async () => {
    // This URL came out of a column that anyone with the table could have written. Refusing is the whole
    // point of `keyFromPhotoUrl`, and reporting it as a success keeps the removal from looking broken.
    const s = stubStorage();
    const elsewhere = "https://someone-else.example.com/church-photos/priest/x.jpg";
    expect(await discardPhotoObject(s.sb, elsewhere, SUPA)).toEqual({ ok: true, removed: false });
    expect(s.removed).toEqual([]);
  });

  it("reports a failed delete rather than swallowing it", async () => {
    // The row has already been cleared by this point, so the photograph is off the page but still being
    // served. A silent success here would claim a removal that did not fully happen.
    const s = stubStorage({ message: "bucket not found" });
    const url = `${SUPA}/storage/v1/object/public/church-photos/council/${uuid}.png`;
    expect(await discardPhotoObject(s.sb, url, SUPA)).toEqual({
      ok: false,
      message: "bucket not found",
    });
  });

  it("does nothing when the deployment has no storage URL to compare against", async () => {
    const s = stubStorage();
    expect(await discardPhotoObject(s.sb, `${SUPA}/storage/v1/object/public/church-photos/priest/${uuid}.jpg`, undefined)).toEqual({
      ok: true,
      removed: false,
    });
    expect(s.removed).toEqual([]);
  });
});