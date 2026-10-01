# 07 — Liturgy

**Status:** Not started
**Roles:** officer and admin (plan and edit), member (view)
**Depends on:** 03, 04
**Size:** M
**Migration:** 029

## 1. Purpose

Help officers plan who serves what, ahead of time and on the day, with less typing and fewer mistakes. Members should be able to see their assignments easily.

## 2. Current behavior

(repo `README.md` §5.8)
- **Planned** mode for future dates (`liturgy_planned`, keyed by date and Mass) and **Session** mode for today or past sessions (`session_liturgy_servers`, keyed by session).
- A session created for a date and Mass is seeded from the planned rows automatically.
- A row is an ordered position label (Crucifix, Candle 1, Thurifer) plus either a searched member or free text. Add, remove and reorder inline.
- Templates store position labels only. Save, load (replaces rows and clears assignees) and delete. Shared by all officers and admins.
- Members see liturgy servers and the full roster on the session page.
- Officer pages: `/officer/day/[date]/plan/[massId]`, `/officer/day/[date]/session/[id]`.

## 3. Problems found

| # | Problem |
|---|---|
| P1 | Position labels are free text, so "Candle 1", "candle 1" and "Candle One" all exist. |
| P2 | Nothing warns when one member is put in two places at the same Mass or on the same morning. |
| P3 | A recurring lineup has to be rebuilt each week. Templates copy positions but not last week's people. |
| P4 | Members cannot easily find their own assignment. |
| P5 | Nobody is reminded the day before. |
| P6 | Nothing printable for the sacristy. |
| P7 | Inactive members can still be assigned. |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| LIT-1 | Planner editor rebuilt: position catalog, drag reorder, member picker | Change |
| LIT-2 | Copy from a previous week | New |
| LIT-3 | Conflict warnings | New |
| LIT-4 | Templates: rename and better list | Change |
| LIT-5 | Upcoming assignments for members | New |
| LIT-6 | Reminders | New |
| LIT-7 | Printable one-page PDF | New |

### LIT-1 Editor

- One editor component used in both modes. The mode is shown as a clear label: "Planning for Sun 26 Oct" or "Serving today".
- Each row: drag handle (plus up and down buttons for keyboard and touch), **position** combobox, **assignee** picker, remove.
- Position combobox suggests from the catalog (`liturgy_positions`) and still accepts a new label, which is added to the catalog after saving.
- Assignee picker: search members (debounced 180 ms), active members only, or switch to **guest name** (free text).
- Save applies to the whole list. Unsaved changes trigger a leave warning.
- Row count and "unassigned positions" shown at the top ("2 of 9 positions unassigned").

### LIT-2 Copy from a previous week

- Button **Copy from…** offers "Same Mass last week" and a date picker. Options: copy positions only, or positions with assignees.
- Copying replaces the current rows after confirmation. Inactive members are dropped and listed in the confirmation.
- Works into planned dates and into sessions.

### LIT-3 Conflict warnings

Warnings are shown inline on the row and in a summary, and never block saving (an officer knows best).

- Same member twice in one Mass.
- Same member in two Masses on the same date. The warning names the other Mass and its time when known.
- Assigned member is inactive (only reachable through copy or old data).
- Member is on the roster of the same session for a different role of the same day is **not** a conflict.

### LIT-4 Templates

- Keep save, load and delete. Add **rename**. The dropdown shows name and slot count.
- Templates store positions only. Load replaces rows and clears assignees, with confirmation.
- A template cannot be saved with zero positions or duplicate labels.

### LIT-5 Upcoming assignments

- Member home shows **Upcoming assignments** for the next 14 days: date, Mass, position and name, grouped by date, with a search box to find a name.
- If the member declared an identity (module 02, AUTH-4), their own rows are highlighted and pinned to the top. Without it the list is still browsable.
- Officers see a **Needs attention** card: dates in the next 14 days with unassigned positions or no plan at all.

### LIT-6 Reminders

- Daily cron at 10:00 UTC (18:00 in Manila). For assignments dated tomorrow it sends a push notification to devices linked to that member: "You're serving tomorrow: Thurifer, 5:30 AM Anticipated."
- Only devices subscribed with a declared identity can be targeted (module 08 adds the link). Others receive nothing individually.
- Free-text guests cannot be notified.

### LIT-7 Printable sheet

- `GET /api/liturgy/pdf?date=YYYY-MM-DD` produces a one-page A4 sheet: date, each Mass with its positions and names. Same brand header as other PDFs. Available to officer and admin.

## 5. API

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/PUT | `/api/liturgy/planned?date=&mass_id=` | admin, officer | PUT replaces rows; returns conflict warnings |
| GET/PUT | `/api/liturgy/session/[id]` | admin, officer | Same |
| POST | `/api/liturgy/copy` | admin, officer | New. Body `{ from: {date, mass_id}, to: {date, mass_id}|{session_id}, include_members }` |
| GET | `/api/liturgy/positions` | admin, officer | New. Catalog |
| GET | `/api/liturgy/upcoming?days=14` | any signed in | New. Names and positions only |
| GET | `/api/liturgy/needs-attention` | admin, officer | New |
| GET | `/api/liturgy/pdf?date=` | admin, officer | New |
| GET/POST | `/api/officer/liturgy-templates` | officer, admin | Adds rename (`PATCH /[id]`) |
| GET/DELETE | `/api/officer/liturgy-templates/[id]` | officer, admin | Unchanged |
| GET | `/api/cron/liturgy-reminders` | secret header | New |

## 6. Data (migration 029)

```txt
liturgy_positions(id, label UNIQUE (case-insensitive), sort_order int DEFAULT 0, is_active bool DEFAULT true)
  -- seeded from DISTINCT position_label in existing tables, normalized
```

The existing tables keep `position_label` as text. Nothing is rewritten; the catalog is a suggestion source, not a foreign key.

## 7. Business rules

- On session creation, planned rows for that (date, mass) seed the session rows, as today. After the session exists, editing planned rows for that date does not change the session.
- `sort_order` is contiguous from 0 after every save.
- Editing a session's liturgy is allowed for past sessions. It is not blocked by the report lock, because liturgy does not affect attendance reports. Confirm this stays true.
- Templates are shared across officers and admins. Deleting one asks for confirmation.
- Case-insensitive catalog: "candle 1" and "Candle 1" are the same label; the stored casing is the first one seen.

## 8. Edge cases

- Copying from a week with no plan: message "Nothing to copy from that date."
- A member deactivated after being assigned. The row shows their name with a warning until replaced.
- Two officers edit the same date. The save returns the saved rows; the last save wins. Show "Updated by another device" if the version changed under you.
- Date crossing midnight: "tomorrow" for reminders is computed in church time.

## 9. Acceptance criteria

- [ ] Position suggestions come from the catalog. Casing and spelling stay consistent after a week of use.
- [ ] Drag reorder and the up and down buttons both work and persist.
- [ ] Copy from last week fills the rows, drops inactive members, and says which.
- [ ] Assigning the same member twice at one Mass, or at two Masses on one date, shows a warning that names the conflict.
- [ ] Members see upcoming assignments for 14 days and can search a name.
- [ ] A subscribed, identified member gets a reminder the evening before.
- [ ] The PDF prints one A4 page for a date with up to three Masses.
- [ ] Templates can be renamed, and cannot be saved empty or with duplicate labels.
- [ ] Audit rows exist for the Liturgy actions in module 02.

## 10. Build tasks

1. Migration 029 with the seeded catalog.
2. Pure rules with tests: conflict detection, copy transform, label normalization.
3. Editor component and both mode pages.
4. Copy endpoint and dialog.
5. Warnings API and UI.
6. Template rename and list improvements.
7. Upcoming and needs-attention endpoints and cards.
8. PDF sheet.
9. Reminder cron (after module 08 links subscriptions to people).
10. Remove the old `LiturgyServerEditor` and `OfficerCreateMassForm` if unused.

## 11. Unit tests

- Conflict detection: same member twice in a Mass, in two Masses the same date, inactive member, no conflict when different dates.
- Copy transform with and without assignees, with inactive members.
- Label normalization and catalog merge.
- Reminder selection: assignments for tomorrow in church time, guests skipped.

## 12. QA checklist

- [ ] Plan next Sunday for two Masses, copy Mass 1 into Mass 2, edit, save.
- [ ] Create the session on the day and confirm rows were seeded.
- [ ] Reorder on a phone with touch.
- [ ] Print the sheet and check the layout.
- [ ] Sign in as a member, find a name in upcoming assignments.

## 13. Out of scope

Automatic assignment rotation, swap requests between members, availability tracking.
