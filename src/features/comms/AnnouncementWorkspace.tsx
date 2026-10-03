"use client";

import { AnnouncementComposer } from "@/features/comms/AnnouncementComposer";
import { MyAnnouncements } from "@/features/comms/MyAnnouncements";

/**
 * The composer's page body, shared by admin, secretary and officer.
 *
 * Replaces `AnnouncementSelfService`, which was three near-identical copies of a title field, a body
 * field and a datetime input, and which had no audience, no pin and no expiry presets at all.
 */
export function AnnouncementWorkspace({ role }: { role: string }) {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h1 className="text-lg font-semibold">Post an announcement</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Choose who should see it. Nobody else receives it, and it does not appear in their feed.
        </p>
        <div className="mt-4">
          <AnnouncementComposer />
        </div>
      </section>

      <MyAnnouncements role={role} />
    </div>
  );
}
