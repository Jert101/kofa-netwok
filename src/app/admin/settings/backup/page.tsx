import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata: Metadata = { title: "Data backup | KofA AMS" };

/**
 * SYS-5's page.
 *
 * A server component, because the download is a plain link and a link gives a real download dialog with a
 * filename. The page exists mostly to say what the file is *not*: it is a way to read the data in a
 * spreadsheet, not a way to put it back, and somebody restoring from one would lose every foreign key in
 * the database.
 */
export default function BackupPage() {
  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Data backup"
        description="Download every table as CSV files in one ZIP."
      />

      <div className="rounded-2xl border border-[var(--brand)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand)]">
          This is an export, not a restore tool
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          The ZIP is for reading the parish&apos;s data in a spreadsheet: members, sessions, attendance,
          appeals, liturgy, payments and reports. It is flat files with no relationships between them, so it
          cannot be loaded back into the app.
        </p>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Recovery is the database provider&apos;s own backups. If the data has to come back, restore from
          theirs and use this file only to check what they restored.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold">What is in it</h2>
        <ul className="mt-2 grid gap-1 text-sm text-[var(--text-muted)] sm:grid-cols-2">
          {[
            "Members and batches",
            "Masses and sessions",
            "Attendance records, live and archived",
            "Appeals and their decisions",
            "Liturgy plans and server assignments",
            "Payment structures and payments",
            "Announcements",
            "Report metadata, not the PDFs",
            "Settings, with secrets removed",
          ].map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          PIN hashes and session timestamps are <strong>not</strong> included. Nobody should ever need
          them out of this application.
        </p>
      </div>

      <a
        href="/api/admin/backup"
        className="inline-flex min-h-12 items-center rounded-xl bg-[var(--brand)] px-5 font-medium text-white"
      >
        Download backup
      </a>

      <p className="text-sm text-[var(--text-muted)]">
        Every download is written to the audit log, with your name and the time.
      </p>
    </div>
  );
}