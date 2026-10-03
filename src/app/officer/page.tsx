"use client";

import Link from "next/link";

import { AssignedServersSection } from "@/components/AssignedServersSection";
import { AttendanceCalendar } from "@/features/attendance/ui/AttendanceCalendar";
import { OfficerNeedsAttention } from "@/features/insights/NeedsAttentionCards";

/**
 * DSH-3's home: the calendar plus what needs planning.
 *
 * Replaces the previous hard-coded NeedsAttentionCard with one driven by module 10's endpoint, so the
 * list and the rule that produces it are the same code.
 */
export default function OfficerHomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Officer</h1>
      <p className="text-sm text-[var(--text-muted)]">
        Choose a date, pick a mass, then assign roles (Crucifix, candles, etc.). Saving notifies
        subscribers with push enabled. Post general notices in{" "}
        <Link href="/officer/inbox" className="underline">
          Announcements
        </Link>
        .
      </p>
      <OfficerNeedsAttention />
      <AssignedServersSection memberBasePath="/officer/day" />
      <AttendanceCalendar role="officer" />
    </div>
  );
}