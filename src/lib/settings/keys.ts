export const SETTING_KEYS = [
  "church_name",
  "church_address",
  "report_title",
  "report_timezone",
  "attendance_auto_approve_appeals",
  "pin_admin_hash",
  "pin_secretary_hash",
  "pin_member_hash",
  "pin_officer_hash",
  "pin_treasurer_hash",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
