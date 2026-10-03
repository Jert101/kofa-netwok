import type { Metadata } from "next";
import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";

export const metadata: Metadata = { title: "Announcements | KofA AMS" };

/**
 * The page an announcement notification links to.
 *
 * It exists as its own route because the catalog's `announcement_posted` link is
 * `/member/announcements#id`, and a deep link that 404s is worse than no deep link: the person
 * tapped "Announcement" expecting to read one.
 */
export default function MemberAnnouncementsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Announcements</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Posts addressed to you. Anything that has run out is no longer listed.
        </p>
      </header>

      <AnnouncementsFeed />
    </div>
  );
}