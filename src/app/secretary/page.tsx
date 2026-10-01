"use client";

import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { AttendanceCalendar } from "@/features/attendance/ui/AttendanceCalendar";
import { CreateWeekendButton } from "@/features/attendance/ui/CreateWeekendButton";

export default function SecretaryHomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Encoding</h1>
      <AnnouncementsFeed />
      <AssignedServersSection memberBasePath="/secretary/day" />
      <AttendanceCalendar role="secretary" />
      <CreateWeekendButton />
    </div>
  );
}
