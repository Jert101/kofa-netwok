# 05 — Appeals

**Status:** Code complete (windows, eligibility, review, auto-approve, retention, report lock). Unit tests and the four automated gates pass. Manual QA (section 12) not yet run.
**Roles:** member (submit), secretary and admin (review)
**Depends on:** 04
**Size:** M
**Migration:** 027

## 1. Purpose

Let members correct attendance mistakes themselves, keep reviewers on top of them, and give everyone a clear outcome. Today appeals disappear once resolved, so nobody learns what happened.

## 2. Current behavior

(repo `README.md` §5.4)
- A member opens a session, searches names, selects up to 40 chips and submits. Names already on the roster or already pending are blocked.
- Result is a modal: submitted, auto-approved, or the server error.
- Secretary and admin review pending items on the session page: Approve, Reject, **Approve all (N)**.
- Approve: upserts the attendance record, deletes all pending items for that member in that session, prunes empty parent appeals, sends a push.
- Reject: deletes the item. Resolved items never accumulate (a deliberate design choice).
- `attendance_auto_approve_appeals` skips review entirely.
- Writes are blocked when the month's report exists.

## 3. Problems found

| # | Problem |
|---|---|
| P1 | The member never sees the outcome. The item is deleted. |
| P2 | Rejection has no reason. |
| P3 | Review happens one session at a time. Nothing lists all pending appeals. |
| P4 | Anyone with the member PIN can appeal for anyone. There is no limit and no time window. |
| P5 | "Approve all" is several separate database calls, not one transaction. A failure midway leaves a partial result. |
| P6 | Pending appeals in a month can be forgotten. Report generation does not warn about them. |
| P7 | After a report locks a month, leftover pending items can never be resolved. |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| APL-1 | Submit form improvements | Change |
| APL-2 | Central review queue plus per-session panel | New |
| APL-3 | Keep resolved appeals as history (decision D-2) | Change |
| APL-4 | Outcome visible to members | New |
| APL-5 | Reject with reason | New |
| APL-6 | Appeal window and abuse limits | New |
| APL-7 | Atomic approval | Change |
| APL-8 | Report generation warns about pending appeals | New |

### APL-1 Submit

- The appeal card stays at the top of the member's session page.
- Same interaction: debounced search, chips (max 40), blocked names open the explanation dialog.
- New: optional note (max 200 chars), for example "Served as thurifer".
- New: the card says who it is for and how long appeals stay open ("Appeals close on {date}").
- The blocking overlay and result dialog stay, since they protect against double submits.

### APL-2 Review

- **Session panel** (existing) on the session screen: pending items newest first, Approve and Reject per item, **Approve all (N)**.
- **Central queue** at `/secretary/appeals` and `/admin/appeals`: all pending items, grouped by session date, filter by month. Each group links to its session. Supports **Approve selected**.
- The calendar's appeal marker (module 04) links into the queue.
- Approve all and Approve selected run behind the blocking overlay.

### APL-3 History (reverses the current convention)

- Resolved items are **kept** with their status, reviewer role, time and reason.
- Statuses: `pending`, `approved`, `rejected`, `expired`.
- Cross-appeal dedupe stays: approving a member for a session marks that member's other pending items in that session as `approved` with `resolution = 'merged_duplicate'`, so nothing is left dangling.
- Parent `attendance_appeals` rows are no longer pruned.
- `member_ids_cannot_appeal` counts only roster members and pending items. A rejected member may appeal again; the reviewer sees "Previously rejected".
- Retention: resolved items older than 12 months are deleted by the daily sweep (setting `appeal_retention_months`).

### APL-4 Outcome visible to members

- The member session page shows an **Appeals for this session** list: name and a status chip (Pending, Approved, Rejected, Expired). The reason shows for rejected items. This uses information members can already see (the roster is visible), and it exposes no contact details.
- If the member declared an identity (module 02, AUTH-4), a **My appeals** list on their home page shows their own appeals across sessions.
- Push notifications to individuals depend on subscriptions linked to a person (module 08). Until then the status list is the outcome channel.

### APL-5 Reject with reason

- Dialog with presets (Not on my records, Duplicate, Outside the window, Other) and an optional note. Stored on the item. Bulk reject is not offered.

### APL-6 Window and limits

- Setting `appeal_window_days` (default 14, `0` = no limit). An appeal is accepted while today (church time) is within N days after the session date **and** the month is not locked.
- Outside the window: 400 `APPEAL_WINDOW_CLOSED` with the closing date.
- Rate limit 10 submissions per hour per client (module 02, AUTH-2). Max 40 items per appeal and 200 pending per session, as today.
- Auto-approve mode still respects the window and the lock. It records `source = 'appeal_auto'` on the attendance record.

### APL-7 Atomic approval

- A Postgres function `approve_appeal_items(session_id, item_ids[], reviewer_role)` does everything in one transaction: verify pending, insert records (ignore duplicates), resolve the items, mark merged duplicates, and return counts.
- The route calls it once. A failure leaves nothing changed.
- The push notification is sent after the transaction commits, and never throws.

### APL-8 Report warning

- `GET /api/reports/can-generate` (module 06) returns `pending_appeals_count` for the report month.
- The generate wizard shows a warning with a link to the queue and asks for confirmation to continue. Admin may continue after confirming; secretary must resolve them first.
- At generation, any pending items left for that month are set to `expired` so nothing stays stuck (the lock would prevent resolving them).

## 5. API

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/api/attendance/session/[id]/appeals` | member | Adds note, window check, throttle. `auto_approved` branch kept |
| GET | `/api/attendance/session/[id]/appeals?status=` | admin, secretary | Default `pending` |
| GET | `/api/attendance/session/[id]` | member | Carries `appeal_window` and `my_appeals`. **Changed:** see below |
| GET | `/api/attendance/appeals?month=&status=` | admin, secretary | New. Central queue |
| PATCH | `/api/attendance/appeals/[id]` | admin, secretary | Body `{ action: 'approve'\|'reject', reason?, note? }` |
| PATCH | `/api/attendance/appeals` | admin, secretary | New. Body `{ session_id, item_ids[] }`, one session |
| POST | `/api/attendance/session/[id]/appeals/approve-all` | admin, secretary | Calls the atomic function |
| GET | `/api/attendance/appeals/month-indicators?month=` | admin, secretary | Unchanged, pending only |

Two endpoints here differ from the first draft of this table, both on purpose.

**No `/appeals/summary` and no cross-session `/appeals/approve`.** The summary is served
inside the session `GET`, which the member page already loads to draw the roster and the
appeal form. A second endpoint returning the same rows would be a second code path to keep
in step with the first, and the member page would then need two requests to render one
screen. Approval is scoped to a single session for the same kind of reason, but sharper:
the atomic function takes one `session_id` because a cross-session approval spans two
months, and a lock on either one would leave the caller unable to tell which half
happened — the exact outcome APL-7 exists to prevent. Selecting across sessions in the
central queue and approving one Mass at a time gets the same work done with no partial
state.

## 6. Data (migration 028)


```txt
attendance_appeals
  + note text NULL

attendance_appeal_items
  status CHECK now includes 'expired'
  + reject_reason text NULL
  + resolution text NULL          -- 'approved' | 'merged_duplicate' | 'rejected' | 'expired'

FUNCTION approve_appeal_items(session_id, item_ids uuid[], reviewer_role text)
INDEX attendance_appeal_items(status, created_at DESC)
```

No data migration. Existing pending items continue as they are.

## 7. Business rules

- Reject and approve check that the item is still `pending`. A second click returns 409 `ALREADY_RESOLVED`.
- The lock guard runs before every write, including approval.
- Appeals for members who are inactive are refused at submit.
- Approving writes an attendance record with `source = 'appeal'`.

## 8. Edge cases

- The same member appealed by two different people. The unique (appeal, member) key handles one appeal; the cross-appeal merge handles two.
- A reviewer approves while another rejects the same item. The first wins; the second sees `ALREADY_RESOLVED`.
- Approving for a session whose month locked one minute ago. The transaction returns `REPORT_LOCKED` and nothing changes.
- The member closes the tab during submit. The beforeunload guard warns; the server call is idempotent per (appeal, member).

## 9. Acceptance criteria

- [ ] After approval or rejection, the member's session page shows the status and the reason.
- [ ] Rejecting requires a reason preset or note.
- [ ] The central queue lists pending appeals across sessions and can approve a selection.
- [ ] **Approve all (N)** is all-or-nothing. A simulated failure leaves zero changes.
- [ ] An appeal after the window closes is refused with the closing date.
- [ ] The eleventh submission in an hour from one client returns 429.
- [ ] Generating a report with pending appeals shows the warning. After generation, no pending items remain for that month; they are `expired`.
- [ ] Resolved items remain visible to reviewers for 12 months.
- [ ] Audit rows exist for the Appeals actions in module 02.

## 10. Build tasks

1. Migration 027 and the `approve_appeal_items` function. Test the function with SQL.
2. Shared schemas and rules: window check, cannot-appeal list (with tests).
3. Update submit route: note, window, throttle.
4. Atomic approve routes (single, selected, all).
5. Reject with reason.
6. Summary endpoint and the member "Appeals for this session" list.
7. Session review panel rebuild.
8. Central queue pages.
9. Warning integration with report generation (coordinate with module 06).
10. Expire pending items at report generation.
11. Retention sweep.

## 11. Unit tests

- Window: inside, on the last day, one day after, `0` meaning unlimited, month locked.
- Cannot-appeal: on roster, pending, previously rejected (allowed), inactive member (refused).
- Merge duplicates: two pending items for one member become one attendance record and both resolve.

## 12. QA checklist

- [ ] Submit an appeal as a member, approve it as secretary, and see the member page update.
- [ ] Approve all with 10 items while a second reviewer rejects one. Result is consistent.
- [ ] Turn on auto-approve. Submit. The record appears with source `appeal_auto`.
- [ ] Lock the month and try every action.
- [ ] Phone: the appeal form and result dialog are usable one-handed.

## 13. Out of scope

Appeals by non-members, attachments or photo proof, appeal comments back and forth.
