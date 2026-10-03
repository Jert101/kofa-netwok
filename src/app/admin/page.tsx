"use client";

import Link from "next/link";
import { AnnouncementsFeed } from "@/components/AnnouncementsFeed";
import { AssignedServersSection } from "@/components/AssignedServersSection";
import { AttendanceCalendar } from "@/features/attendance/ui/AttendanceCalendar";
import { CreateWeekendButton } from "@/features/attendance/ui/CreateWeekendButton";
import { AdminDashboardCards } from "@/features/insights/AdminDashboardCards";

/**
 * DSH-1's home.
 *
 * The calendar stays, at the bottom. Spec §DSH-1's order puts the dashboard above it, because the
 * dashboard answers "what does the parish need" and the calendar answers "when is the next Mass" --
 * and a secretary-facing question is the first one asked.
 */
export default function AdminDashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold sm:text-xl">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          How the parish is doing, and who could use a phone call.
        </p>
      </div>

      <AdminDashboardCards />
      <AnnouncementsFeed />

      <AssignedServersSection memberBasePath="/admin/day" />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Calendar</h2>
        <AttendanceCalendar role="admin" />
        <div className="mt-3">
          <CreateWeekendButton />
        </div>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          <Link href="/admin/audit" className="underline">
            Audit log
          </Link>{" "}
          records every change anybody makes.
        </p>
      </section>
    </div>
  );
}