"use client";

import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { AttendanceCalendar } from "@/features/attendance/ui/AttendanceCalendar";
import { CreateWeekendButton } from "@/features/attendance/ui/CreateWeekendButton";
import { SecretaryNeedsAttention } from "@/features/insights/NeedsAttentionCards";

/**
 * DSH-2's home: the calendar plus a worklist.
 *
 * The attention card sits above the calendar, because the first question a secretary opens the app with
 * is "what is outstanding" rather than "what is this week".
 */
export default function SecretaryHomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Encoding</h1>
      <SecretaryNeedsAttention />
      <AnnouncementsFeed />
      <AssignedServersSection memberBasePath="/secretary/day" />
      <AttendanceCalendar role="secretary" />
      <CreateWeekendButton />
    </div>
  );
}