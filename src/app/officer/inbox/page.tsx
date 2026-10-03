"use client";

import { AnnouncementWorkspace } from "@/features/comms/AnnouncementWorkspace";
import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";

/**
 * COM-2: the officer's page, renamed.
 *
 * It was called "inbox" and showed announcements, which is the confusion the spec describes. The nav
 * label now says Announcements and this page says so too. The officer has no notification inbox in
 * this module; nothing writes them one.
 */
export default function OfficerAnnouncementsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-lg font-semibold">Announcements</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Post to the parish or to part of it, and manage what you have already posted.
        </p>
      </div>

      <AnnouncementsFeed />
      <AnnouncementWorkspace role="officer" />
    </div>
  );
}
