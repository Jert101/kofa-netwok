# 03 — Registration & members

**Status:** Not started
**Roles:** public applicant, admin (review and directory). Officers, secretaries and members use the member search only.
**Depends on:** 01, 02
**Size:** L
**Migration:** 025

## 1. Purpose

Get people into the system correctly and keep the directory clean. Covers the public application, admin review, the member directory, batches, imports and a per-member profile.

## 2. Current behavior

Registration (repo `README.md` §5.1):
- Public form creates a `registration_requests` row with `status = 'pending'`.
- Admin page has Pending, Approved and Rejected tabs, and per-row Approve, Reject, Edit and Change status. Bulk approve and reject act on all currently listed pending rows.
- Approving inserts a `members` row. A duplicate active name shows the raw database unique-violation to the admin.
- Rejected requests can go back to pending.

Members (§5.2):
- Directory with filters (batch, gender, active, birth month), inline active toggle, add and edit.
- Unique constraint on `lower(trim(full_name)) WHERE is_active`.
- Batches are managed on the Settings page.
- Members list PDF (landscape A4).

## 3. Problems found

| # | Problem |
|---|---|
| P1 | Duplicates are found only at approval, and the error is a database message. |
| P2 | Bulk approve acts on everything in the list. There is no way to pick rows. |
| P3 | The applicant never learns the outcome. |
| P4 | Rejection has no reason. |
| P5 | The directory has no pagination and no member profile. There is no way to see one person's attendance. |
| P6 | Deactivation has no reason or date. |
| P7 | Adding many members means typing them one by one. |
| P8 | Batches live in Settings, far from where they are used. |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| REG-1 | Application form (built in module 01), plus reference code on confirmation | Change |
| REG-2 | Silent duplicate flagging at submit | New |
| REG-3 | Public status check by reference code | New |
| REG-4 | Admin review table with row selection and bulk actions on selected rows | Change |
| REG-5 | Reject with reason | New |
| REG-6 | Friendly approval conflict handling | Change |
| MEM-1 | Directory table: server pagination, search, sort, filters | Change |
| MEM-2 | Add and edit in a side sheet | Change |
| MEM-3 | Deactivate with reason and date, reactivate | Change |
| MEM-4 | Member profile with attendance stats | New |
| MEM-5 | CSV import with preview | New |
| MEM-6 | Batches manager on the members page | Change |
| MEM-7 | PDF list (kept) and CSV export | Change |

### REG-2 Duplicate flagging

- On submit, the server compares the normalized name (`lower`, trimmed, single spaces) to active members and to other pending requests.
- On a match it stores `possible_duplicate_member_id` (or flags a pending-vs-pending match) and still accepts the application.
- **The applicant is not told** about a match. Confirming that a name exists would leak membership to the public.
- The admin sees a badge on the row: "Possible duplicate of {Name}".

### REG-3 Public status check

- The confirmation card shows a reference code: 8 characters from an unambiguous alphabet (no `0/O/1/I`). Stored in `registration_requests.reference_code`, unique.
- `/register/status` has one field for the code. It shows Pending, Approved, or Rejected with the reason, and nothing else about the person.
- Throttled like login (AUTH-2). Wrong codes return the same "Not found" message.

### REG-4 Review table

- Tabs: Pending, Approved, Rejected, each with a count.
- Columns: checkbox, name, date of birth, gender, contact, batch, submitted, flags.
- Selecting rows enables **Approve {n}** and **Reject {n}**. With no selection the buttons are hidden. A "Select all on this page" checkbox is in the header. Bulk actions ask for confirmation naming the count.
- Row menu: Approve, Reject, Edit, Change status.
- **Edit** opens a sheet. Editing is allowed on pending and rejected rows, not on approved ones (edit the member instead).
- PDF export of the current tab is kept.

### REG-5 Reject with reason

- A dialog with preset reasons (Incomplete details, Not eligible, Duplicate application, Other) and an optional note (max 200 chars). Bulk reject uses one reason for all selected rows.
- The reason shows on the applicant's status page.

### REG-6 Approval conflicts

If an active member already has the same name, approval stops and shows: "A member named {Name} is already active. Link this application to that member, edit the name, or reject." Actions: **Edit name**, **Reject as duplicate**. Nothing is inserted.

### MEM-1 Directory

- Search by name. Filters: batch, gender, status, birth month. Sort by name, batch, date of birth.
- 25 rows per page by default. Column visibility toggle. On a phone the table becomes a list of cards (name, batch, status).
- Inline active toggle is replaced by MEM-3.

### MEM-3 Deactivation

- **Deactivate** opens a dialog: reason presets (Moved away, Aged out, Left the group, Other) plus a note. Saves `is_active = false`, `deactivated_at`, `deactivation_reason`.
- **Reactivate** clears the reason and date. If an active member with the same name now exists, reactivation fails with the conflict message from REG-6.
- Records are never hard-deleted.

### MEM-4 Member profile (`/admin/members/[id]`)

Sections:
1. **Details**: name, date of birth, gender, contact, batch, status, deactivation info. Edit button.
2. **Attendance**: lifetime sessions served, rate over the last 3 months, current weekend streak, last served date. Data comes from live plus archived records.
3. **Recent sessions**: the last 20 sessions with date, Mass and whether present. Filter "Sundays only".
4. **Payments** (read-only): structures and remaining balance, link to the treasurer ledger. Shown to admin only.

Metric definitions (shared with module 10):
- **Attendance rate** = distinct sessions attended ÷ sessions held in the period (a session counts as held if it has at least one attendance record), over live and archived tables. Toggle "Sundays only".
- **Weekend streak** = number of consecutive weekends, counting back from the latest weekend that has any session, in which the member attended at least one session.

### MEM-5 CSV import

- Template download with headers: `first_name,last_name,middle_initial,date_of_birth,gender,contact_number,batch`.
- Steps: choose file → parsed in the browser → **preview table** with a status per row (OK, error with reason, duplicate) → **Import {n} valid rows** → result summary (imported, skipped, with a downloadable error CSV).
- Limits: 500 rows per file, 1 MB.
- Rules per row use the same Zod schema as registration. Duplicates are matched by normalized name against active members and against other rows in the file. Unknown batch years are created only if the admin ticks "Create missing batches".
- The server re-validates everything. The client preview is a convenience, not trust.

### MEM-6 Batches

- A "Batches" tab on the members page. Table with year and member count.
- Add a year (four digits). Delete is blocked when members or payment structures use the year: "2025 is used by 34 members and 1 payment structure."
- Batches are also used by registration and payment scope.

### MEM-7 Exports

- PDF list (existing) keeps its filters, header and columns.
- CSV export of the current filter, same columns.

## 5. API

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/api/register` | public | Adds reference code, duplicate flag, throttling. Returns `{ reference_code }` |
| GET | `/api/register/status?code=` | public | New. Throttled |
| GET | `/api/public/batches` | public | New if needed (D-8). Years only |
| GET | `/api/admin/registration-requests` | admin | Adds pagination and flags |
| PATCH | `/api/admin/registration-requests/[id]` | admin | Approve, reject (with reason), edit, change status |
| POST | `/api/admin/registration-requests/bulk` | admin | Body `{ action, ids[], reason? }`. Ids required, no "all" |
| GET | `/api/admin/registration-requests/pdf` | admin | Unchanged |
| GET | `/api/admin/members` | admin | Pagination, search, sort, filters |
| POST/PATCH | `/api/admin/members` `/[id]` | admin | Create, edit, deactivate, reactivate |
| GET | `/api/admin/members/[id]` | admin | Details |
| GET | `/api/admin/members/[id]/stats` | admin | Attendance metrics and recent sessions |
| POST | `/api/admin/members/import/validate` | admin | Returns per-row results, saves nothing |
| POST | `/api/admin/members/import/commit` | admin | Inserts valid rows in one transaction |
| GET | `/api/admin/members/pdf` `/csv` | admin | Filters as query params |
| GET/POST/DELETE | `/api/admin/member-batches` | admin | Adds `member_count`, delete guard |
| GET | `/api/members/search?q=` | admin, secretary, officer, member | Unchanged shape, minimal fields |

## 6. Data (migration 025)

```txt
registration_requests
  + reference_code text UNIQUE            -- backfill existing rows
  + reject_reason text
  + possible_duplicate_member_id <same type as members.id> NULL

members
  + deactivated_at timestamptz NULL
  + deactivation_reason text NULL
```

Backfill `reference_code` for existing rows. Add an index on `registration_requests(status, created_at DESC)`.

## 7. Business rules

- Approval, rejection and status changes stamp `reviewed_at` and write an audit row.
- A rejected request keeps its reason if moved back to pending; the reason is cleared on approval.
- Import and approval share one function that creates a member, so both enforce the same rules.
- Names are stored as entered but compared normalized. `full_name` is composed from parts as today.

## 8. Edge cases

- Two admins approve the same request at once. The second gets 409 "This request was already reviewed."
- A name with punctuation or accents (`Ma. Cristina`, `Niño`) must match itself. Normalize case and whitespace only, not accents.
- Date of birth in the future or before 1900 is rejected.
- Import file with mixed date formats. Accept ISO `YYYY-MM-DD` and `MM/DD/YYYY`; anything else is a row error.
- Very large directories: the API caps `pageSize` at 100.

## 9. Acceptance criteria

- [ ] Submitting an application shows a reference code. `/register/status` returns the correct state and reason.
- [ ] Submitting a name that matches an active member succeeds for the applicant and shows a duplicate badge to the admin.
- [ ] Bulk approve affects only the selected rows, after a confirmation that names the count.
- [ ] Rejecting requires a reason preset or note.
- [ ] Approving a duplicate name shows the friendly conflict dialog and inserts nothing.
- [ ] Directory paginates, searches, sorts and filters on the server. A 1,000-member list loads in under 1 second.
- [ ] Deactivating stores a reason and date. Reactivating clears them.
- [ ] The profile shows lifetime count, 3-month rate, streak and the last 20 sessions, including archived data.
- [ ] CSV import previews errors, imports only valid rows, and reports skipped rows.
- [ ] A batch in use cannot be deleted and the message says by whom it is used.
- [ ] Audit rows exist for every action listed in module 02 under Registrations and Members.

## 10. Build tasks

1. Migration 025 and backfill.
2. Shared Zod schemas and name normalization helper (with tests).
3. Register API changes: reference code, duplicate flag, throttle. Update the form's confirmation card.
4. Status page and API.
5. Review table with tabs, selection and bulk bar.
6. Reject dialog with reasons. Approval conflict dialog.
7. Members API with pagination and filters. Directory table.
8. Add and edit sheet. Deactivate and reactivate dialogs.
9. Stats endpoint and profile page.
10. Batches tab with delete guard.
11. CSV import (validate, commit, error download).
12. PDF and CSV export.
13. Remove the old admin registrations and members pages.

## 11. Unit tests

- Name normalization and duplicate matching (case, spaces, accents preserved).
- Reference code generator: alphabet, length, no ambiguous characters.
- Import row validation for each rule and each date format.
- Attendance rate and streak calculators with fixed sample data, including archived rows.

## 12. QA checklist

- [ ] Register on a phone, copy the code, check status from another browser.
- [ ] Approve, reject, move back to pending, approve again.
- [ ] Import a file with 3 good rows, 1 duplicate, 1 bad date, 1 unknown batch.
- [ ] Open the profile of a member whose month was archived. Their history is complete.
- [ ] Deactivate someone who is on a planned liturgy. The planner still opens.

## 13. Out of scope

Photos, guardian or emergency contacts, merging two member records, member self-service edits.
