# 08 — Announcements & notifications

**Status:** Code complete. Unit tests, `tsc`, lint and build pass. Manual QA (section 12) not yet run.
**Roles:** admin, secretary and officer (post announcements); admin, secretary and super admin (inbox); everyone (read announcements, enable push)
**Depends on:** 02
**Size:** M
**Migration:** 031

## 1. Purpose

Get the right message to the right people without noise: announcements with an audience and pinning, an inbox with an unread badge, and push notifications that can be aimed at a role or a person.

## 2. Current behavior

(repo `README.md` §5.9–5.10, §11)
- Announcements: title, body, created by admin, secretary, officer or `system` (birthday posts). Auto-expiry through `delete_at`, cleaned lazily. Feed shows newest first. Delete by creator role or admin.
- Inbox notifications: `notifications(from_role, to_role, title, body, read_at)`, readable by admin, secretary and super admin. Emitters: report generated, report pending, report decided, registration outcomes, appeal activity.
- Web Push: `push_subscriptions(endpoint, p256dh, auth)` with a service worker. Roster changes notify subscribed devices. `broadcast.ts` sends to everyone.
- Birthday cron at 00:00 UTC posts a system announcement.
- The officer's `inbox` page is actually the announcements page.

## 3. Problems found

| # | Problem |
|---|---|
| P1 | Push goes to every subscribed device. Subscriptions have no role or person, so a message meant for the super admin reaches everyone. |
| P2 | No unread badge in the navigation, although the docs say there is one. |
| P3 | Announcements go to everyone. No audience, no pinning, no editing. |
| P4 | Notifications carry no link, so tapping one does not take you to the thing. |
| P5 | If the birthday cron runs twice it can post twice. |
| P6 | Nobody can tell whether push is on for their device, or test it. |
| P7 | Notification recipients are limited to three roles. |
| P8 | Emitters are scattered through route handlers with no single list. |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| COM-1 | Announcements: audience, pinning, expiry presets, editing | Change |
| COM-2 | Inbox with unread badge and deep links | Change |
| COM-3 | Push targeted by role and person | Change |
| COM-4 | Device notification settings and test | New |
| COM-5 | One event catalog for all emitters | New |
| COM-6 | Idempotent cron jobs and sweeps | Change |

### COM-1 Announcements

- **Compose** in a sheet: title (max 100), body (plain text with line breaks, max 2,000), audience, expiry, pin, send push.
- **Audience:** Everyone, or selected roles, or selected batches. Stored on the row and applied when the feed is read.
- **Expiry presets:** 1 week, 1 month, custom date, never. Default 1 month.
- **Pinned** announcements stay at the top. At most three at a time; pinning a fourth asks which to unpin.
- **Edit** by the creator role or admin for the life of the announcement. Shows "Edited" with the time.
- **Delete** with confirmation, by creator role or admin.
- System birthday posts have their own style and cannot be edited.
- Feed on member home and role dashboards: pinned first, then newest, with a "Show older" control.

### COM-2 Inbox

- One inbox page for admin, secretary and super admin at `/…/inbox`. The officer's page is renamed and stays an announcements view.
- Items show title, body preview, time, and an unread dot. Filters All and Unread. Open an item to read and mark it read. **Mark all read**.
- Every notification can carry a `link`. Tapping it opens the target: a report, a session, a registration.
- **Unread badge** on the sidebar item and the tab bar. `GET /api/notifications/unread-count`, refreshed every 60 seconds and on focus. The shell reads a `badgeKey` from the nav config.
- Recipients extend to every role, so officer and treasurer can receive notifications later.

### COM-3 Targeted push

- `push_subscriptions` gains `role`, an optional `member_id` (from the declared identity, module 02) and `topics`.
- `broadcast.ts` accepts a target: `{ roles?: [], member_ids?: [], topic }`, and only sends to matching subscriptions.
- Topics: `attendance` (roster changes), `announcements`, `reports`, `liturgy`. A device receives only the topics it enabled.
- Dead subscriptions (HTTP 404 or 410 from the push service) are deleted on failure.
- Push is best effort: errors are logged, never thrown, and never block the request.

### COM-4 Device settings

- A **Notifications** page (from the account menu) shows the state of this device: unsupported, blocked, off, on.
- Buttons: **Turn on notifications**, **Send a test**, **Turn off**. Topic toggles for the roles that use them.
- iOS needs the app added to the Home Screen first. When the browser is iOS Safari and not installed, show short steps instead of a dead button.
- Subscribing sends the declared identity (if any) so reminders and appeal results can reach the person.

### COM-5 Event catalog

A single source of truth, `lib/notify/events.ts`. Emitters call `notify(eventKey, payload)` and nothing else builds messages.

| Event | In-app inbox to | Push to | Link |
|---|---|---|---|
| `registration_submitted` | admin | admin, topic `announcements` off | Registrations |
| `registration_reviewed` | admin | none | Registrations |
| `appeal_submitted` | admin, secretary | secretary devices, topic `attendance` | Session appeals |
| `attendance_updated` | none | devices on topic `attendance` | Session |
| `report_pending` | super admin | super admin devices, topic `reports` | Review view |
| `report_reminder` | super admin, admin | same | Review view |
| `report_decided` | originating role | originating role devices | Reports |
| `announcement_posted` | none | audience devices, topic `announcements` | Announcement |
| `liturgy_reminder` | none | the assigned member's devices | Session |
| `birthday_today` | none | all, topic `announcements` | Home |

Each event defines its title and body copy in one place, in plain language.

### COM-6 Idempotent jobs

- `announcements.dedupe_key` (unique, nullable). The birthday job sets it to `birthday:YYYY-MM-DD`, so a rerun updates nothing.
- The daily sweep deletes announcements past `delete_at`, old `login_attempts`, old audit rows and resolved appeals past retention.
- Each cron run records its result in `cron_runs` (module 11).

## 5. API

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST | `/api/announcements` | admin, secretary, officer (POST), all signed in (GET filtered by audience) | Adds audience, pin, expiry, `send_push` |
| PATCH/DELETE | `/api/announcements/[id]` | creator role or admin | Edit and delete |
| GET | `/api/notifications` | admin, secretary, super admin | Adds filter `unread` and pagination |
| PATCH | `/api/notifications/[id]` | same | Mark read |
| POST | `/api/notifications/read-all` | same | New |
| GET | `/api/notifications/unread-count` | same | New |
| POST | `/api/push/subscribe` | any signed in | Adds `role`, `member_id`, `topics` |
| POST | `/api/push/topics` | any signed in | New. Update topics for this device |
| POST | `/api/push/test` | any signed in | New. Sends to this device only |
| POST | `/api/push/unsubscribe` | any signed in | Unchanged |
| GET | `/api/cron/birthday` | secret header | Idempotent via dedupe key |
| GET | `/api/cron/sweep` | secret header | New. Daily sweep |

## 6. Data (migration 031)

```txt
announcements
  + audience_roles text[] NULL          -- NULL or empty = everyone
  + audience_batches text[] NULL
  + pinned boolean NOT NULL DEFAULT false
  + updated_at timestamptz NULL
  + dedupe_key text NULL UNIQUE

notifications
  + link text NULL
  to_role CHECK widened to all six roles
  from_role CHECK widened the same way (the dispatchers stamp the caller's role)

push_subscriptions
  + role text NULL
  + member_id <members.id type> NULL
  + topics text[] NOT NULL DEFAULT '{attendance,announcements,reports,liturgy}'
```

Existing subscriptions keep working with a null role, and receive broadcast-style events only until they resubscribe. The subscribe route updates role and topics for an existing endpoint on the next visit.

## 7. Business rules

- Audience is enforced in the query, never only in the UI.
- Pinned limit is three. Expired announcements never show, even before the sweep removes them.
- An announcement with `send_push` sends once at creation, to matching devices only.
- A member with no declared identity matches only role-based audiences and "Everyone". Batch audiences match declared members only.
- Notification bodies contain no phone numbers, dates of birth or payment amounts.

## 8. Edge cases

- Browser permission denied. The settings page explains how to re-enable it and does not keep asking.
- Two devices for one person. Both get the push, which is expected.
- Push service returns an error for one device in a fan-out. Others still receive it.
- Announcement audience set to a batch that has no members. Allowed, with a warning in the composer.
- Clock: expiry compared in UTC, displayed in church time.

## 9. Acceptance criteria

- [ ] A report pending notification and push reach the super admin only, not other roles.
- [ ] The unread badge appears on the nav within 60 seconds of a new notification and clears after reading.
- [ ] Tapping a notification opens the linked page.
- [ ] Announcements honor audience, pinning (max 3), expiry and editing. Deleted or expired ones never show.
- [ ] The device settings page shows the true state and **Send a test** arrives.
- [ ] Turning off the `attendance` topic stops roster pushes to that device only.
- [ ] Running the birthday job twice creates one post.
- [ ] Dead subscriptions are removed after a failed send.
- [ ] Every emitter in the catalog goes through `notify()`. A grep finds no other push-building code.
- [ ] Audit rows exist for the Comms actions in module 02.

## 10. Build tasks

1. Migration 031 (`liturgy_reminders_sent` included, for LIT-6).
2. Event catalog and `notify()`, with tests for recipient selection.
3. Targeted `broadcast` and dead-subscription cleanup.
4. Subscribe and topics endpoints. Device settings page.
5. Inbox page, unread count, badge in the shell.
6. Announcement composer, feed, edit and delete.
7. Dedupe key on the birthday job. Daily sweep endpoint.
8. Move existing emitters to `notify()` one route at a time.
9. Remove the old `AnnouncementSelfService`, `AnnouncementsFeed`, `PwaHub` pieces that are replaced.

## 11. Unit tests

- Recipient selection for each event (roles, topics, member targets).
- Audience filter: everyone, role list, batch list, identified and anonymous members.
- Pin limit and expiry visibility.
- Dedupe key format and rerun behavior.

## 12. QA checklist

Deferred to final handoff, like every other module's manual pass. The automated gates in sections 9 and 11 run clean; these five need two browsers and an iPhone and cannot be faked by a test suite.

- [ ] Two browsers: super admin and secretary. Generate a report. Only the super admin is notified.
- [ ] Post to Everyone and to one batch. Check what a member in another batch sees.
- [ ] Block notifications in the browser and open the settings page.
- [ ] iOS Safari before and after adding to the Home Screen.
- [ ] Run the sweep and confirm expired items vanish.

## 13. Out of scope

Email and SMS channels, WhatsApp or Telegram bots, per-announcement read receipts, replies or comments.
