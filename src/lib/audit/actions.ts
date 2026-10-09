export const AUDIT_ACTIONS = [
  // Auth
  "login_failed",
  "login_succeeded",
  "pin_changed",
  "sessions_revoked",
  "actor_selected",
  // Registrations
  "registration_approved",
  "registration_rejected",
  "registration_bulk_approved",
  "registration_bulk_rejected",
  "registration_status_changed",
  "registration_edited",
  // REG-6: approved by pointing at a member who was already on the roll, so the
  // trail shows the request did not create anyone.
  "registration_linked_to_member",
  // Members
  "member_created",
  "member_updated",
  "member_deactivated",
  "member_reactivated",
  "members_imported",
  "batch_created",
  "batch_deleted",
  // Attendance
  "session_created",
  "session_deleted",
  "attendance_changed",
  "attendance_roster_replaced",
  // Appeals
  "appeal_approved",
  "appeal_rejected",
  "appeals_approved_all",
  "appeal_auto_approved",
  "appeal_submitted",
  "appeals_approved_selected",
  "appeal_rejected_with_reason",
  // Reports
  "report_generated",
  "report_approved",
  "report_rejected",
  "report_archived",
  "report_downloaded",
  // RPT-5: also the record of "was this report already reminded today?", which is how the
  // one-per-day cap is enforced without a dedicated table.
  "report_reminder_sent",
  // Liturgy
  "liturgy_saved",
  "liturgy_cleared",
  "liturgy_copied",
  "liturgy_template_saved",
  "liturgy_template_deleted",
  "liturgy_template_renamed",
  // LIT-7: the sacristy sheet is the one copy of the plan that leaves the building.
  "liturgy_sheet_downloaded",
  // Comms
  "announcement_created",
  "announcement_updated",
  "announcement_deleted",
  // The parish's public face. Names real people and is shown to signed-out visitors, so who changed it
  // is recorded rather than inferred from a settings diff.
  "church_profile_updated",
  "council_member_added",
  "council_member_updated",
  "council_member_removed",
  // Photographs of identifiable people, published to signed-out visitors. Who uploaded one is a
  // question worth being able to answer later, and the row alone does not record it.
  "church_photo_uploaded",
  // Module 08: a device subscribing is not free. It is a person asking to be interrupted, and
  // without a row in the audit log there is no way to answer "why is this phone getting these".
  "push_subscription_created",
  // Payments
  "structure_created",
  "structure_updated",
  "payment_recorded",
  "payment_voided",
  // Settings
  "settings_updated",
  "backup_downloaded",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  login_failed: "Login failed",
  login_succeeded: "Login succeeded",
  pin_changed: "PIN changed",
  sessions_revoked: "Sessions revoked",
  actor_selected: "Actor selected",
  registration_approved: "Registration approved",
  registration_rejected: "Registration rejected",
  registration_bulk_approved: "Registrations approved in bulk",
  registration_bulk_rejected: "Registrations rejected in bulk",
  registration_status_changed: "Registration status changed",
  registration_edited: "Registration edited",
  registration_linked_to_member: "Registration linked to an existing member",
  member_created: "Member created",
  member_updated: "Member updated",
  member_deactivated: "Member deactivated",
  member_reactivated: "Member reactivated",
  members_imported: "Members imported",
  batch_created: "Batch created",
  batch_deleted: "Batch deleted",
  session_created: "Session created",
  session_deleted: "Session deleted",
  attendance_changed: "Attendance changed",
  attendance_roster_replaced: "Attendance roster replaced",
  appeal_approved: "Appeal approved",
  appeal_rejected: "Appeal rejected",
  appeals_approved_all: "All appeals approved",
  appeal_auto_approved: "Appeal auto-approved",
  appeal_submitted: "Appeal submitted",
  appeals_approved_selected: "Selected appeals approved",
  appeal_rejected_with_reason: "Appeal rejected with reason",
  report_generated: "Report generated",
  report_approved: "Report approved",
  report_rejected: "Report rejected",
  report_archived: "Report archived",
  report_downloaded: "Report downloaded",
  report_reminder_sent: "Report review reminder sent",
  liturgy_saved: "Liturgy saved",
  liturgy_cleared: "Liturgy cleared",
  liturgy_copied: "Liturgy copied from another date",
  liturgy_template_saved: "Liturgy template saved",
  liturgy_template_deleted: "Liturgy template deleted",
  liturgy_template_renamed: "Liturgy template renamed",
  liturgy_sheet_downloaded: "Liturgy sheet downloaded",
  announcement_created: "Announcement created",
  announcement_updated: "Announcement updated",
  announcement_deleted: "Announcement deleted",
  church_profile_updated: "Parish profile updated",
  council_member_added: "Council member added",
  council_member_updated: "Council member updated",
  council_member_removed: "Council member removed",
  church_photo_uploaded: "Parish photograph uploaded",
  push_subscription_created: "Push device subscribed",
  structure_created: "Payment structure created",
  structure_updated: "Payment structure updated",
  payment_recorded: "Payment recorded",
  payment_voided: "Payment voided",
  settings_updated: "Settings updated",
  backup_downloaded: "Backup downloaded",
};
