"use client";

import { useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/church/profile";
import { MAX_PHOTO_BYTES, PHOTO_TYPE_LABEL, formatBytes } from "@/lib/church/photos";

/**
 * Choose or clear one person's photograph.
 *
 * A file input with the label hidden and a button over it, rather than a bare `<input type="file">`.
 * The native control is a small button with the OS's own wording, gives no room for a preview, and cannot
 * show why a file was refused -- so the button, the preview and the reason all live here instead.
 *
 * The initials are not a fallback bolted on; they are what shows while nobody has chosen a photograph, so
 * a council member with no picture still looks like a person rather than a gap.
 *
 * Size and format are checked in the browser first, because a 6 MB phone photo should be refused before
 * it is uploaded rather than after. The server checks them again -- on the bytes, not the filename --
 * so the browser check is a courtesy and never the guard.
 */
export function PhotoField({
  photoUrl,
  personName,
  scope,
  memberId,
  onUploaded,
  onRemoved,
  size = "md",
}: {
  photoUrl: string | null;
  personName: string;
  scope: "priest" | "council";
  /** Required for `scope: "council"`. */
  memberId?: string;
  onUploaded: (url: string) => void;
  onRemoved: () => void;
  size?: "md" | "lg";
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  const dimension = size === "lg" ? "size-20 text-xl" : "size-14 text-lg";

  const upload = async (file: File) => {
    setProblem(null);

    // The browser's copy of the checks. `file.type` is advisory and is not trusted by the server, but it
    // is good enough to avoid uploading something obviously wrong.
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      setProblem(`Choose a JPEG, PNG or WebP image. (${PHOTO_TYPE_LABEL["image/png"]} and JPEG work best.)`);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setProblem(`That photo is ${formatBytes(file.size)}. Please use one under 2 MB.`);
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("scope", scope);
      if (memberId) form.append("member_id", memberId);

      const res = await fetch("/api/church/photo", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { photo_url?: string } };
      const url = (body.data as { photo_url?: string } | undefined)?.photo_url ?? null;
      if (!res.ok || !url) {
        setProblem("The photograph could not be uploaded. Check it is under 2 MB and try again.");
        return;
      }
      setBroken(false);
      onUploaded(url);
    } catch {
      setProblem("Could not reach the server.");
    } finally {
      setBusy(false);
      // Cleared so choosing the same file twice in a row still fires a change event.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={`grid ${dimension} shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--brand-soft)] font-semibold text-[var(--brand-text)]`}
      >
        {photoUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt=""
            className="size-full object-cover"
            // A photograph that 404s -- an old bucket, a deleted object -- falls back to the initials
            // rather than showing a browser's broken-image glyph in the middle of the council.
            onError={() => setBroken(true)}
            loading="lazy"
          />
        ) : personName.trim() ? (
          initialsOf(personName)
        ) : (
          <ImageOff className="size-5 opacity-60" />
        )}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 aria-hidden className="animate-spin" />
                Uploading…
              </>
            ) : photoUrl ? (
              "Replace photo"
            ) : (
              "Add a photo"
            )}
          </Button>
          {photoUrl ? (
            <Button size="sm" variant="ghost" onClick={onRemoved} disabled={busy}>
              Remove
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          JPEG, PNG or WebP, up to 2 MB. Optional — initials stand in until then.
        </p>
        {problem ? (
          <p role="alert" className="mt-1 text-xs text-[var(--danger-text)]">
            {problem}
          </p>
        ) : null}
      </div>

      {/* Visually replaced by the button above; kept in the DOM so it is reachable by keyboard and
          announced by a screen reader, which a button that merely calls .click() on a display:none
          input is not on every platform. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={`Photograph for ${personName || "this person"}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}