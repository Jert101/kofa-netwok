# 04 — Masses & attendance

**Status:** Code complete (masses, sessions, encoding, live and archive, CSV, needs-attention, per-role session screens). Unit tests and the four automated gates pass. Manual QA (section 12) not yet run.
**Roles:** admin (Masses catalog, everything), secretary (daily encoding), officer and member (read-only session view)
**Depends on:** 03
**Size:** L
**Migration:** 026

## 1. Purpose

Make recording attendance fast and safe: sessions created for you, an encoding screen built for a phone in one hand, and clear locking once a month's report exists. Target: encode one Mass in under 60 seconds.

## 2. Current behavior

(repo `README.md` §5.3)
- Admin defines Mass types (name, optional `default_sunday`), soft-deactivate only.
- A session is one Mass on one date, unique per (date, mass). The secretary creates each one by hand: pick date, pick Mass, open the roster.
- The roster lists active members with search. Tap to mark present (insert record), tap again to remove. Free-text notes per session.
- Any write calls `guardReportNotGenerated(session_date)`; if a non-rejected report exists for that month the API returns 409.
- Admin and secretary have separate session pages with duplicated markup. Officer and member have their own detail pages.

## 3. Problems found

| # | Problem |
|---|---|
| P1 | Every session is created by hand, every week. |
| P2 | Two secretaries encoding at once can overwrite each other when the roster is saved as a whole. |
| P3 | A bad connection at church loses taps. |
| P4 | No undo, no "mark all present", no way to see who is missing at a glance. |
| P5 | Attendance can be encoded for future dates. |
| P6 | Four separate session pages to maintain. |
| P7 | Empty months and locked months are not visible on the calendar. |
| P8 | Mass types have no order or usual time. |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| ATT-1 | Masses catalog with order and default time | Change |
| ATT-2 | Automatic weekend sessions | New |
| ATT-3 | Month calendar with indicators | Change |
| ATT-4 | One shared session screen for all roles | Change |
| ATT-5 | Fast roster encoding with idempotent taps | Change |
| ATT-6 | Retry queue for unreliable connections | New |
| ATT-7 | Lock banner and read-only state | Change |
| ATT-8 | Future-date rule | New |
| ATT-9 | Delete an empty session | New |

### ATT-1 Masses catalog (`/admin/masses`)

- Table: name, usual time, default Sunday, active, order.
- Add and edit in a sheet. Reorder with up and down buttons (and drag on desktop). Deactivate only.
- Deactivating a Mass hides it from the "Add session" picker but keeps history.

### ATT-2 Automatic weekend sessions

- Setting `auto_create_sunday_sessions` (default on).
- A cron job runs weekly on Thursday 00:00 UTC. For the coming Sunday it creates one session per active Mass with `default_sunday = true`. It is idempotent: the (date, mass) unique key makes a rerun harmless.
- The calendar also has a button **Create this weekend's sessions** for the secretary and admin.
- Empty sessions do not affect reports, because the report column list only includes sessions with at least one record.
- New sessions still seed their liturgy servers from planned liturgy, as today.
- Never creates sessions in a locked month.

### ATT-3 Calendar

- Month grid, today marked, previous and next month.
- Each day shows: number of sessions, a dot if any session has attendance, an appeals marker if pending appeals exist (secretary and admin only), and a lock icon on every day of a locked month.
- Tapping a day opens the day view: the sessions of that day with present counts, **Add session** (pick Mass), and a link to each session.
- Days with sessions but no attendance are marked "Needs encoding" for past dates.

### ATT-4 One session screen

- One feature component, `SessionScreen`, used by every role at its own route:
  - admin and secretary: editable roster, appeals review, liturgy summary.
  - officer: liturgy editor, roster read-only.
  - member: liturgy servers, full roster read-only, appeal form on top (module 05).
- Old duplicate pages are removed.

### ATT-5 Roster encoding

- Sticky top bar: session title, **12 / 48 present**, save status.
- Search field. Filter chips: All, Present, Absent.
- Rows are at least 48 px high, name on the left, present toggle on the right. Tap anywhere on the row.
- Sort: Alphabetical (default) or **Recent servers first** (members who served most in the last 8 weeks appear first).
- **Mark all present** and **Clear all**, both behind a confirmation. Undo for the last 20 changes.
- Notes: a text area under the roster, saved on blur.
- Each tap sends an idempotent call `set present = true|false` for one member. Two secretaries changing different members never conflict. If both change the same member, the last write wins and the screen updates on the next refresh.
- The counter and rows refresh on window focus and every 20 seconds while the tab is visible.
- The old `PUT …/records` (replace whole roster) stays for admin repair and imports.

### ATT-6 Retry queue

- If a call fails because of the network, the change goes to a local queue (browser storage, max 200 entries) and the status pill shows "Offline — 3 changes waiting".
- The queue flushes in order when the connection returns. A server rejection (locked, session gone) removes that entry and shows a toast that names the member.
- This is not offline mode. The page still needs to be loaded first.

### ATT-7 Locking

- When the month is locked: a banner "The {Month} report is {Pending approval|Approved}. Attendance is read-only." with a link to the report for admin and secretary. All toggles are disabled.
- A rejected report unlocks the month, and the banner disappears.
- The server guard stays the source of truth. The UI only mirrors it.

### ATT-8 Future dates

- Attendance cannot be encoded for a session whose date is after today in church time. The screen shows "This Mass hasn't happened yet." Sessions can still be created ahead of time.
- Decision D-6.

### ATT-9 Delete an empty session

- Admin only. Allowed when the session has no attendance records, no appeals and no liturgy rows. The unique key makes it safe to recreate.

## 5. API

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/api/masses*` | admin | Adds `sort_order`, `default_time`, reorder |
| POST | `/api/attendance/sessions` | admin, secretary | Create. 409 `SESSION_EXISTS` returns the existing id |
| POST | `/api/attendance/sessions/weekend` | admin, secretary | New. Creates the coming weekend's sessions |
| DELETE | `/api/attendance/session/[id]` | admin | New. Only when empty |
| GET | `/api/attendance/session/[id]` | mixed | Unchanged, plus `locked`, `locked_reason`, `is_future` |
| POST | `/api/attendance/session/[id]/records/set` | admin, secretary | New. Body `{ changes: [{ member_id, present }] }`, idempotent |
| PUT | `/api/attendance/session/[id]/records` | admin | Replace roster (repair) |
| PATCH | `/api/attendance/session/[id]` | admin, secretary | Notes |
| GET | `/api/attendance/by-day`, `/month-indicators` | mixed | Adds lock and needs-encoding flags |
| GET | `/api/cron/sessions` | secret header | New. ATT-2 |

Cron entry added to `vercel.json`. All write routes call the lock guard, then the future-date guard.

## 6. Data (migration 026)

```txt
masses
  + sort_order int NOT NULL DEFAULT 0
  + default_time time NULL

attendance_records
  + source text NOT NULL DEFAULT 'encoded'    -- 'encoded' | 'appeal' | 'appeal_auto' | 'import'
  + recorded_at timestamptz NOT NULL DEFAULT now()
  + recorded_by_role text NULL
```

Add an index on `attendance_records(member_id)` and `attendance_sessions(session_date)` if missing. Backfill `sort_order` from current name order.

## 7. Business rules

- `guardReportNotGenerated(session_date)` covers create, set, replace, notes, delete and appeals.
- A session is unique per (date, mass). The response for a duplicate includes the existing session id so the client can open it.
- Only active members appear in the roster. A member deactivated after being marked present stays in that session's record.
- "Recent servers first" uses live plus archived records from the last 8 weeks.

## 8. Edge cases

- Two devices toggling the same member. Last write wins. The UI re-reads after each save and never trusts local state alone.
- A session opened before the month became locked. The next toggle returns 409 `REPORT_LOCKED`, the row snaps back, and the banner appears.
- Timezone: "today" and the future-date check use church time, not the browser clock.
- A Mass deactivated after sessions exist. Existing sessions stay editable.
- The cron runs twice. No duplicates, because of the unique key.

## 9. Acceptance criteria

- [ ] The coming weekend's sessions exist by Thursday without anyone clicking, and the manual button does the same.
- [ ] A 48-member Mass can be encoded in under 60 seconds on a phone.
- [ ] Two devices marking different members at once both persist. Neither overwrites the other.
- [ ] With the network off, five taps show "5 changes waiting" and all save when the network returns.
- [ ] Marking all present and undoing returns the exact previous roster.
- [ ] A locked month shows the banner, disables toggles, and the API returns 409 on any write.
- [ ] Encoding a future session is blocked, with the message.
- [ ] One `SessionScreen` serves all four roles with the right permissions. The old pages are gone.
- [ ] Calendar shows sessions, encoded days, pending appeals and locked months correctly.
- [ ] Audit rows exist for the Attendance actions in module 02.

## 10. Build tasks

1. Migration 026.
2. Pure rules with tests: lock guard, future-date guard, recent-servers ranking.
3. Masses page with order and default time.
4. Session create API with `SESSION_EXISTS`, weekend endpoint, delete endpoint.
5. `records/set` endpoint.
6. `SessionScreen` shell with role variants and lock banner.
7. Roster component: rows, search, filters, counter, notes.
8. Bulk actions and undo.
9. Retry queue and status pill.
10. Calendar with indicators and day view.
11. Cron job and `vercel.json` entry.
12. Replace the four old session pages. Delete `SecretaryAttendanceForm` and related dead code.

## 11. Unit tests

- Lock guard: no report, pending, approved, rejected for the same month, and a different month.
- Future-date guard at midnight boundaries in `Asia/Manila`.
- Recent-servers ranking with ties, archived rows, and members with no history.
- Queue: ordering, cap of 200, removal on rejection.
- Weekend date calculation, including a month boundary and a Sunday that is the 31st.

## 12. QA checklist

- [ ] Two phones on the same session, mark different people, refresh both.
- [ ] Airplane mode mid-encoding, then reconnect.
- [ ] Generate a report, return to that month's session. It is read-only. Reject the report as super admin. It is editable again.
- [ ] Open a session as each role and confirm what is editable.
- [ ] Rotate the phone. Search and the counter stay usable.

## 13. Out of scope

QR self check-in, kiosk mode, full offline mode with a sync engine, sessions for events other than Masses.
