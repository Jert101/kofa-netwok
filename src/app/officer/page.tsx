"use client";

import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { AttendanceCalendar } from "@/features/attendance/ui/AttendanceCalendar";

export default function OfficerHomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Officer</h1>
      <p className="text-sm text-[var(--muted)]">
        Choose a date, pick a mass, then assign roles (Crucifix, candles, etc.). Saving notifies subscribers with push
        enabled. Post general notices below or in <strong>Announcements</strong> in the menu.
      </p>
      <AnnouncementsFeed />
      <AssignedServersSection memberBasePath="/officer/day" />
      <AttendanceCalendar role="officer" />
    </div>
  );
}
