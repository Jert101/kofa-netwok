"use client";

import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { AttendanceCalendar } from "@/features/attendance/ui/AttendanceCalendar";

export default function MemberHomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Attendance</h1>
      <AnnouncementsFeed />
      <AssignedServersSection memberBasePath="/member/day" />
      <AttendanceCalendar role="member" />
    </div>
  );
}
