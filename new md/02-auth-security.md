# 02 — Auth & security

**Status:** Code complete, migrations not yet applied. Migrations `023` and `024` are written but still need to be run against the database by hand; audit and throttle paths cannot be exercised until then. `tsc`, `lint`, `test` (85 tests) and `build` pass. The cron entry for the daily sweep is deferred to module 11, so `/api/cron/maintenance` can be called manually. Not yet verified in a browser.
**Roles:** all (login), admin (PIN management, audit log)
**Depends on:** 01
**Size:** L
**Migrations:** 023 (`audit_log`), 024 (`login_attempts`)

## 1. Purpose

Keep the fast, shared-device role PIN model, but close its gaps: unsafe default PINs, no brute-force protection, sessions that cannot be revoked, and no record of who did what.

## 2. Current behavior

- One shared PIN per role. Hashes are stored in `system_settings` (`pin_<role>_hash`), bcrypt cost 10.
- `POST /api/auth/login` compares the PIN against each role hash in the order admin, secretary, member, officer, treasurer, super_admin, and signs a 7-day HS256 JWT in the `kofa_session` cookie.
- Edge middleware checks the signature and the role's route prefix. Every API route calls `requireRole()`.
- Fresh installs seed every PIN to `1234`.
- A non-empty super admin PIN switches on the report approval workflow.

## 3. Problems found

| # | Problem | Risk |
|---|---|---|
| P1 | The first matching hash wins. With all PINs seeded to `1234`, everyone becomes admin. Two roles sharing a PIN make the later role unreachable. | High |
| P2 | No limit on failed logins. A 4-digit PIN can be guessed in minutes. | High |
| P3 | Changing a PIN does not end existing sessions. A stolen cookie works for 7 days. | High |
| P4 | `POST /api/register` is public and unthrottled. It can be flooded. | Medium |
| P5 | No record of who approved, voided or generated anything. Reports say only "secretary" or "admin". | Medium |
| P6 | Clearing the super admin PIN while reports are pending leaves them pending with nobody able to approve. | Medium |
| P7 | The default PIN can stay in place indefinitely. Nothing forces a change. | High |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| AUTH-1 | PIN rules: unique across roles, no trivial PINs, forced change of defaults | New |
| AUTH-2 | Login and public-form throttling | New |
| AUTH-3 | Session revocation (sign out all devices, and on PIN change) | New |
| AUTH-4 | "Who's using this device?" step (self-declared identity) | New |
| AUTH-5 | Audit log and admin viewer | New |
| AUTH-6 | Security page for PIN management | Change |
| AUTH-7 | Guard against clearing the super admin PIN with pending reports | New |

### AUTH-1 PIN rules

- Length 4–12, digits only for new PINs. Existing non-numeric PINs keep working until changed.
- Reject repeated or sequential PINs (`0000`, `1111`, `1234`, `4321`, `2580`) and PINs on a short common list.
- **Unique across roles.** When setting a PIN, compare it to the other five hashes. If it matches one, reject with `PIN_IN_USE`: "This PIN is already used by another role. Choose a different one."
- **Default detection.** After an admin logs in, check whether any role's hash still matches `1234`. If so, show a blocking banner on every admin page: "Default PINs are still in use for: Secretary, Member. Change them now." The banner links to the Security page and cannot be dismissed until fixed. The check runs only at admin login (six bcrypt compares).
- **Legacy duplicates.** If two roles already share a PIN, login keeps today's resolution order, and the Security page shows a warning listing the roles.

### AUTH-2 Throttling

- Table `login_attempts(id, ip_hash, kind, success, attempted_at)`. `ip_hash` is a salted hash of the client IP, never the raw address. `kind` is `login`, `register` or `appeal`.
- **Login:** 5 failures per 15 minutes per `ip_hash`. The next attempt returns 429 with `Retry-After`. Also 30 failures per hour across all IPs triggers a global slowdown of 2 seconds per attempt.
- **Register:** 5 submissions per hour per `ip_hash`, a hidden honeypot field, and a minimum of 3 seconds between page load and submit. Failing the honeypot returns success without saving.
- **Appeals:** 10 submissions per hour per `ip_hash` (used by module 05).
- A successful login does not reset the counter for other IPs.
- Rows older than 7 days are deleted by the daily sweep.

Serverless functions share no memory, so limits are stored in the database.

### AUTH-3 Session revocation

- Keys `sessions_valid_after_<role>` in `system_settings` hold an ISO timestamp.
- `requireRole()` and the role layouts reject a session whose `iat` is earlier than its role's value.
- Changing a role's PIN sets that role's value to now. The Security page also has **Sign out all devices** per role.
- If an admin changes their own PIN, the server reissues a fresh cookie for that request so they stay signed in.
- Edge middleware still checks only the signature and route prefix, so it stays fast. Pages are protected by the layout check and data by `requireRole()`. This limitation is intentional and must stay documented.

### AUTH-4 Who's using this device

- After a successful PIN login, if `require_actor_name` is on (default on for admin, secretary, officer, treasurer and super admin; optional for members), show a step: "Who's using this device?" with a member search.
- The choice is stored in the session as `actor: { id, name }`. **Switch person** is in the account menu.
- This is **self-declared, not authentication.** The UI says "Signed in as Secretary · Maria Santos". Sensitive data must never depend on it alone (decision D-1).
- Uses: audit log, "generated by" on reports, and for members a convenience (highlight my assignments, show my appeals).
- Members may skip. Skipped means anonymous, exactly like today.

### AUTH-5 Audit log

Table `audit_log`:

| Column | Notes |
|---|---|
| `id` | uuid |
| `at` | timestamptz, default now |
| `actor_role` | role from the session |
| `actor_member_id` | nullable, from AUTH-4 |
| `actor_name` | name snapshot at the time |
| `action` | `noun_verb`, see list |
| `entity_type`, `entity_id` | what changed |
| `meta` | jsonb: counts, ids, before/after summary. No PINs, hashes or full personal data |
| `ip_hash` | salted hash |

Indexes: `(at DESC)`, `(action, at DESC)`, `(entity_type, entity_id)`.

**Actions to log.** Each module adds its own calls, but the names are fixed here:

| Area | Actions |
|---|---|
| Auth | `login_failed`, `login_succeeded` (staff roles only), `pin_changed`, `sessions_revoked`, `actor_selected` |
| Registrations | `registration_approved`, `registration_rejected`, `registration_bulk_approved`, `registration_bulk_rejected`, `registration_status_changed`, `registration_edited` |
| Members | `member_created`, `member_updated`, `member_deactivated`, `member_reactivated`, `members_imported`, `batch_created`, `batch_deleted` |
| Attendance | `session_created`, `session_deleted`, `attendance_changed` (counts), `attendance_roster_replaced` |
| Appeals | `appeal_approved`, `appeal_rejected`, `appeals_approved_all`, `appeal_auto_approved` |
| Reports | `report_generated`, `report_approved`, `report_rejected`, `report_archived`, `report_downloaded` |
| Liturgy | `liturgy_saved`, `liturgy_template_saved`, `liturgy_template_deleted` |
| Comms | `announcement_created`, `announcement_deleted` |
| Payments | `structure_created`, `structure_updated`, `payment_recorded`, `payment_voided` |
| Settings | `settings_updated`, `backup_downloaded` |

**Viewer** at `/admin/audit`: table with date range, role, action and text search, newest first, 50 per page, CSV export of the current filter. Read-only. Retention setting `audit_retention_months` (default 12), enforced by the daily sweep.

### AUTH-6 Security page

`/admin/security`, replacing the PIN grid in Settings.

- One card per role. Each shows the role name, "PIN last changed {date}" (from `system_settings.updated_at`), **Change PIN** and **Sign out all devices**.
- **Change PIN** dialog: new PIN, confirm, live rule feedback (length, trivial, in use). Saves with bcrypt cost 10.
- The super admin card is titled "Super admin (report approval)" and says: "Setting a PIN turns on report approval. Clearing it turns approval off."
- A warning strip lists default PINs in use and any duplicate PINs.

### AUTH-7 Super admin PIN guard

- Clearing the super admin PIN while any report has `status = 'pending'` is rejected with `PENDING_REPORTS_EXIST`: "Resolve the {n} pending report(s) before turning approval off."
- Setting a super admin PIN when none existed is allowed at any time and affects only new reports.

## 5. API

| Method | Path | Roles | Change |
|---|---|---|---|
| POST | `/api/auth/login` | public | Adds throttling, returns `actor_required` flag |
| POST | `/api/auth/actor` | any signed in | New. Body `{ member_id }`, sets or changes the actor |
| POST | `/api/auth/logout` | any | Unchanged |
| POST | `/api/admin/pins` | admin | Validates AUTH-1 rules and AUTH-7, sets `sessions_valid_after` |
| POST | `/api/admin/pins/revoke` | admin | New. Body `{ role }` |
| GET | `/api/admin/security/status` | admin | New. Default PINs in use, duplicates |
| GET | `/api/admin/audit` | admin | New. Filters and pagination |
| GET | `/api/admin/audit/csv` | admin | New |
| POST | `/api/register` | public | Adds throttling and honeypot |

Server helpers: `lib/audit/log-audit.ts`, `lib/auth/throttle.ts`, `lib/auth/pin-rules.ts` (pure), `lib/auth/session-valid.ts`.

## 6. Edge cases

- **Locking yourself out.** Changing your own PIN must reissue your cookie. Test it.
- **Clock skew.** Compare `iat` with a 5-second tolerance.
- **Shared IPs.** A church wifi shares one public IP. Five wrong attempts by one person block everyone there for 15 minutes. Mitigation: the admin can clear throttles from the Security page (button "Clear login blocks").
- **Actor deleted or deactivated.** The audit `actor_name` snapshot survives.
- **Proxy headers.** Read the client IP from `x-forwarded-for` (first value) on Vercel.
- **Rate limit on the audit route.** None needed; admin only.

## 7. Acceptance criteria

- [ ] Setting a PIN already used by another role is rejected with a clear message.
- [ ] `1234`, `0000` and `1111` are rejected as new PINs.
- [ ] After an admin logs in on a fresh install, a blocking banner names every role still on the default PIN.
- [ ] Six wrong PINs in a row from one client give 429 on the sixth and show the wait time.
- [ ] Changing the secretary PIN signs out every secretary session within one request.
- [ ] An admin who changes their own PIN stays signed in.
- [ ] Clearing the super admin PIN with pending reports is rejected.
- [ ] Every action in the list above produces an audit row with the right role and, when set, the actor name.
- [ ] `/admin/audit` filters by date, role and action, and exports CSV.
- [ ] `POST /api/register` returns 429 after five submissions from one client in an hour.
- [ ] No PIN, hash or raw IP is ever written to `audit_log` or `login_attempts`.

## 8. Build tasks

1. Migration 023 and `logAudit()`. Add unit tests. Merge first so other modules can call it.
2. Migration 024 and the throttle helper.
3. `pin-rules.ts` (pure) with unit tests.
4. Update `POST /api/admin/pins` with rules, duplicate check, revocation, AUTH-7.
5. Session-validity check in `requireRole()` and in the six role layouts.
6. Throttling on login, register and appeals.
7. Actor step: endpoint, session field, dialog, account menu entry.
8. Security page.
9. Default-PIN banner.
10. Audit viewer and CSV export.
11. Daily sweep for old `login_attempts` and `audit_log` rows (cron added in module 11 health list).

## 9. Unit tests

- `pin-rules`: length, digits, repeated, sequential (ascending and descending), common list, uniqueness against a list of hashes.
- Throttle window math: exactly 5 failures, window rollover, per-IP isolation.
- Session validity: `iat` before and after `sessions_valid_after`, with tolerance.
- Audit `meta` sanitizer strips keys named `pin`, `hash`, `password`.

## 10. QA checklist

- [ ] Fresh database: log in with `1234`, see the banner, change every PIN, banner disappears.
- [ ] Two browsers logged in as secretary. Change the secretary PIN in a third. Both are signed out on the next click.
- [ ] Wrong PIN five times, wait, confirm the block lifts.
- [ ] Audit page: perform one action from each area and find it.
- [ ] Try to register from a script in a loop. It is limited.

## 11. Out of scope

Per-person accounts, passwords, OAuth, email or SMS codes, two-factor auth. If the organization later wants real accounts, this module is where it would start.
