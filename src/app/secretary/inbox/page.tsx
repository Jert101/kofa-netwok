"use client";

import { InboxList } from "@/features/comms/InboxList";
import { AnnouncementWorkspace } from "@/features/comms/AnnouncementWorkspace";
import { DirectMessageForm } from "@/features/comms/DirectMessageForm";

export default function SecretaryInboxPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="mb-1 text-lg font-semibold">Inbox</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Messages for your role. Opening one marks it read and takes you where it points.
        </p>
      </div>

      <InboxList />

      <section aria-labelledby="msg-admin">
        <h2 id="msg-admin" className="text-sm font-semibold text-[var(--text-muted)]">
          Message the admin
        </h2>
        <DirectMessageForm recipientLabel="admin" />
      </section>

      <AnnouncementWorkspace role="secretary" />
    </div>
  );
}
