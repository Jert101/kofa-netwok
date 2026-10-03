"use client";

import { InboxList } from "@/features/comms/InboxList";

/**
 * COM-2: the super admin had notifications arriving since module 05 and nowhere to read them.
 *
 * No composer and no message form on purpose. The super admin approves and rejects; they do not
 * post to the parish, and offering them a composer would be inventing a permission the spec does not
 * grant.
 */
export default function SuperAdminInboxPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="mb-1 text-lg font-semibold">Inbox</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Reports waiting on you, and reminders about the ones that are still waiting.
        </p>
      </div>

      <InboxList />
    </div>
  );
}
