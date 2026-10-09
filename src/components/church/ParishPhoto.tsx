"use client";

import { useState } from "react";

import { initialsOf } from "@/lib/church/profile";

/**
 * One person's face, or their initials.
 *
 * A client component for one reason: the photograph has to be able to fail. A URL that 404s -- an object
 * deleted from the bucket, a database restored from before the upload -- otherwise renders the browser's
 * broken-image glyph in the middle of the council, which looks like a bug in the parish's own website.
 * Falling back to initials is a graceful end; the initials are the honest answer when there is no
 * photograph.
 *
 * The `<img>` is plain rather than `next/image` on purpose. These are small round avatars on a public
 * page, the host is a Supabase project URL that would have to be allow-listed in `images.remotePatterns`
 * before the optimiser would touch it, and an optimisation that resizes a 64px avatar does nothing a
 * browser's own decoder does not already do.
 */
export function ParishPhoto({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);

  if (!url || broken) {
    return <>{name.trim() ? initialsOf(name) : "?"}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="size-full object-cover"
      onError={() => setBroken(true)}
      loading="lazy"
      decoding="async"
    />
  );
}