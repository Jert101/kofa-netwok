# 11 — Settings & system

**Status:** Not started
**Roles:** admin
**Depends on:** 02
**Size:** S
**Migration:** 033

## 1. Purpose

One tidy place for the church's identity and the switches that control behavior, plus tools to keep the system healthy: a health page, a data backup and a record of scheduled jobs. PIN management moves to the Security page (module 02), and batches move to Members (module 03).

## 2. Current behavior

(repo `README.md` §5.13)
- Settings keys in `system_settings`: `church_name`, `church_address`, `report_title`, `report_timezone`, `attendance_auto_approve_appeals`, and the six PIN hashes.
- One Settings page with sections: report header, batch manager, auto-approve toggle, PIN grid.
- Cron jobs run on Vercel with a secret. There is no way to see whether they ran.

## 3. Problems found

| # | Problem |
|---|---|
| P1 | Many settings from other modules now need a home. |
| P2 | No way to tell whether crons ran or whether required environment values are set. |
| P3 | No way to take a backup of the data outside the database provider. |
| P4 | Settings are read from the database with untyped strings. |
| P5 | The timezone is free text. An invalid value would break every schedule rule. |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| SYS-1 | Settings page with sections and typed values | Change |
| SYS-2 | Settings registry with validation | New |
| SYS-3 | Health page | New |
| SYS-4 | Cron run log | New |
| SYS-5 | Data backup download | New |

### SYS-1 Settings page

Sections, each with its own **Save changes** button and a "Saved" toast. Unsaved edits show a warning if you leave.

| Section | Contents |
|---|---|
| Church identity | Name, address, report title. A live preview of the report header. |
| Time | Timezone picker (searchable list of IANA zones). Shows the current local time for the chosen zone as a check. |
| Attendance | Auto-create weekend sessions, appeal window in days, auto-approve appeals |
| Reports | Archive data at generation (default on), report retention notes |
| Security | Require "who's using this device" per role, audit retention months. Link to the Security page for PINs |
| Data | Appeal retention months, backup, link to the health page |

### SYS-2 Settings registry

`lib/settings/keys.ts` becomes a typed registry: key, type, default, validator, description, and the module that uses it. `getSetting(key)` returns the typed value. `PATCH /api/admin/settings` validates against the registry, so an unknown key or bad value is rejected.

| Key | Type | Default | Used by |
|---|---|---|---|
| `church_name` | string | — | Reports, PDFs |
| `church_address` | string | — | Reports, PDFs |
| `report_title` | string | — | Reports |
| `report_timezone` | IANA zone | `Asia/Manila` | All date rules |
| `attendance_auto_approve_appeals` | boolean | false | Appeals |
| `appeal_window_days` | int ≥ 0 | 14 | Appeals |
| `appeal_retention_months` | int 1–60 | 12 | Sweep |
| `auto_create_sunday_sessions` | boolean | true | Attendance |
| `archive_on_generate` | boolean | true | Reports (no-super-admin path) |
| `require_actor_name` | per-role booleans | staff on, members off | Auth |
| `audit_retention_months` | int 1–60 | 12 | Sweep |

PIN hashes and `sessions_valid_after_<role>` are also in `system_settings` but are managed only by module 02 and never returned by the settings API.

### SYS-3 Health page (`/admin/settings/system`)

A read-only checklist with a green, amber or red state and a fix hint for each:

- Database reachable.
- Required environment values set: `JWT_SECRET` (at least 16 characters), Supabase URL and service key, VAPID keys, `CRON_SECRET`. Shows set or missing, never the values.
- Timezone valid.
- Default PINs in use (from module 02).
- Duplicate PINs.
- Super admin configured (approval workflow on or off).
- Push: number of subscribed devices, and failures in the last 7 days.
- Storage bucket `reports` reachable.
- Each cron job: last run time, result, and whether it is overdue.
- Migrations: highest applied number.

### SYS-4 Cron run log

- Table `cron_runs(id, job, started_at, finished_at, ok, detail)`. Every cron endpoint wraps its work with `recordCronRun(job, fn)`.
- Jobs: `birthday`, `sweep`, `sessions`, `report-reminders`, `liturgy-reminders`.
- The health page reads the latest row per job. A job is overdue when its last success is older than twice its interval.
- Rows older than 90 days are removed by the sweep.

### SYS-5 Backup

- **Download backup** (admin only) produces a ZIP of CSV files: members, batches, masses, sessions and records (live and archive), appeals, liturgy, announcements, payment structures, payments, reports metadata (not the PDFs), and settings without secrets.
- Generated on the server in a streaming fashion, with a size guard. An audit row `backup_downloaded` is written.
- The page explains that it is a data export, not a restore tool, and that the database provider's own backups remain the source of recovery.

## 5. API

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/PATCH | `/api/admin/settings` | admin | Registry-validated, no secrets |
| GET | `/api/admin/health` | admin | New. Checklist data |
| GET | `/api/admin/backup` | admin | New. ZIP stream |
| GET | `/api/cron/*` | secret header | Existing and new jobs, now recorded |

## 6. Data (migration 033)

```txt
cron_runs(id uuid PK, job text, started_at timestamptz, finished_at timestamptz NULL, ok boolean NULL, detail text NULL)
INDEX cron_runs(job, started_at DESC)
```

Settings need no DDL.

## 7. Business rules

- Only the registry's keys can be written through the settings API.
- Changing the timezone shows a warning: "This changes when reports open and when 'today' starts."
- Changing the timezone or window settings takes effect immediately and is audited with old and new values.
- The health page never shows secret values, only whether they are set.

## 8. Edge cases

- A missing setting row. `getSetting` returns the registry default.
- An old row with an invalid value (for example a bad timezone). The health page shows red, and the app falls back to `Asia/Manila` rather than failing.
- A very large database when making a backup. The stream and the size guard stop the request cleanly with a message.
- Two admins saving the same section. The last save wins; the second sees the newer values on reload.

## 9. Acceptance criteria

- [ ] All keys in the table are editable with validation. An invalid timezone is impossible to save.
- [ ] The report header preview matches what appears on the next PDF.
- [ ] The health page correctly flags: missing env value, default PIN, duplicate PIN, an overdue cron job.
- [ ] Every cron endpoint records a run. A forced failure shows red with its detail.
- [ ] The backup ZIP opens, contains every listed file, and contains no PIN hashes or secrets.
- [ ] Settings changes write audit rows with old and new values.
- [ ] Nothing reads settings except through `getSetting`.

## 10. Build tasks

1. Registry with types and validators. Tests.
2. Migrate existing settings reads to `getSetting`.
3. Settings page sections.
4. Migration 033 and `recordCronRun`. Wrap existing cron endpoints.
5. Health endpoint and page.
6. Backup endpoint and page.
7. Remove the old Settings page pieces (PIN grid moved to module 02, batches moved to module 03).

## 11. Unit tests

- Registry validators: timezone (valid and invalid IANA names), ranges, booleans.
- `getSetting` defaults and fallback on invalid stored values.
- Overdue calculation for each job interval.
- Backup: file list and secret stripping.

## 12. QA checklist

- [ ] Change the church name and generate a preview to see the header change.
- [ ] Break a cron secret on staging and confirm the health page shows it.
- [ ] Download a backup and open two of the CSV files.
- [ ] Change the timezone and confirm the report window display changes.

## 13. Out of scope

Restore from backup, multi-parish settings, logo upload, theme editing in the UI.
