/**
 * What goes in the backup ZIP, and in what column order.
 *
 * Split out of the route for two reasons: a Next.js route module may only export HTTP verbs and the build
 * fails on anything else, and the file list is worth asserting in a test -- a new table added here should
 * be a deliberate choice rather than an accident of whatever the code happened to read.
 */

/** Above this many rows in one table, the export stops and says so rather than hitting the function timeout. */
export const BACKUP_ROW_LIMIT = 250_000;

/** Settings keys that must never appear in the export, whatever happens. */
export const SECRET_SETTING_KEYS: readonly string[] = [
  "pin_admin_hash",
  "pin_secretary_hash",
  "pin_member_hash",
  "pin_officer_hash",
  "pin_treasurer_hash",
  "pin_super_admin_hash",
];
export type TableSpec = {
  /** Name of the CSV inside the ZIP. */
  file: string;
  table: string;
  /** Column order, so the file is readable and stable between downloads. */
  columns: string[];
  /** Columns never written, whatever else is asked for. */
  exclude?: readonly string[];
};

export const BACKUP_TABLES: TableSpec[] = [
  {
    file: "members.csv",
    table: "members",
    columns: ["id", "full_name", "batch", "is_active", "date_of_birth", "gender", "contact_number", "created_at"],
  },
  { file: "member_batches.csv", table: "member_batches", columns: ["id", "year", "created_at"] },
  { file: "masses.csv", table: "masses", columns: ["id", "name", "time", "notes"] },
  {
    file: "sessions.csv",
    table: "attendance_sessions",
    columns: ["id", "session_date", "mass_id", "notes", "created_at"],
  },
  {
    file: "attendance_records.csv",
    table: "attendance_records",
    columns: ["id", "session_id", "member_id", "source", "recorded_at", "recorded_by_role", "created_at"],
  },
  {
    file: "attendance_records_archive.csv",
    table: "attendance_records_archive",
    columns: ["id", "session_id", "member_id", "member_name", "archived_at", "report_id"],
  },
  {
    file: "attendance_sessions_archive.csv",
    table: "attendance_sessions_archive",
    columns: ["id", "session_date", "mass_id", "mass_name", "archived_at", "report_id"],
  },
  {
    file: "appeals.csv",
    table: "attendance_appeal_items",
    columns: [
      "id",
      "appeal_id",
      "member_id",
      "status",
      "resolution",
      "reject_reason",
      "reviewed_at",
      "reviewed_by_role",
      "created_at",
    ],
  },
  {
    file: "liturgy_planned.csv",
    table: "liturgy_planned",
    columns: ["id", "session_date", "mass_id", "position_label", "member_id", "free_text", "sort_order"],
  },
  {
    file: "session_liturgy_servers.csv",
    table: "session_liturgy_servers",
    columns: ["id", "session_id", "position_label", "member_id", "free_text", "sort_order"],
  },
  {
    file: "payment_structures.csv",
    table: "payment_structures",
    columns: [
      "id",
      "name",
      "amount",
      "deadline",
      "installment_months",
      "for_all",
      "batch",
      "is_active",
      "created_at",
    ],
  },
  {
    file: "payments.csv",
    table: "payments",
    columns: [
      "id",
      "member_id",
      "payment_structure_id",
      "amount_paid",
      "paid_at",
      "notes",
      "created_by",
      "voided",
      "void_reason",
      "voided_at",
      "created_at",
    ],
  },
  {
    file: "announcements.csv",
    table: "announcements",
    columns: [
      "id",
      "title",
      "body",
      "created_by",
      "created_at",
      "delete_at",
      "audience_roles",
      "audience_batches",
      "pinned",
      "dedupe_key",
    ],
  },
  {
    file: "reports.csv",
    table: "reports",
    columns: ["id", "report_month", "title", "status", "created_at", "reviewed_at", "summary_json"],
  },
  {
    // Spec §SYS-5 lists settings in the export. Only the exposed ones, so no hash and no session
    // timestamp leaves this system. `internal` is never a member of the settings list this reads.
    file: "settings.csv",
    table: "system_settings",
    columns: ["key", "value", "updated_at"],
    exclude: ["pin_admin_hash", "pin_secretary_hash", "pin_member_hash", "pin_officer_hash", "pin_treasurer_hash", "pin_super_admin_hash"],
  },
];



/**
 * The file names inside the ZIP. Asserted by the tests, so the list cannot grow or shrink unnoticed.
 */
export function backupFileNames(): string[] {
  return BACKUP_TABLES.map((t) => t.file);
}