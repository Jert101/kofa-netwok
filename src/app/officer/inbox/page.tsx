"use client";

import { AnnouncementSelfService } from "@/components/AnnouncementSelfService";

export default function OfficerInboxPage() {
  return (
    <div>
      <h1 className="mb-2 text-lg font-semibold">Announcements</h1>
      <p className="text-sm text-[var(--muted)]">Post and manage announcements visible to members.</p>
      <AnnouncementSelfService />
    </div>
  );
}
