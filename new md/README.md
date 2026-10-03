# KOFA-AMS Revamp — Module Docs

This folder is the build plan for the revamp. Each module has one doc that says what exists today, what is wrong with it, what we are building, how it should behave, and how we know it is done. Build one module at a time, in the order below.

The system reference for the *current* app is [`docs/README.md`](../docs/README.md). These docs describe the *target*.

## How to use a module doc

1. Read the module doc top to bottom before writing code.
2. Resolve any open decision listed in its **Decisions** section (also indexed below).
3. Work through its **Build tasks** in order. Each task is small enough for one commit.
4. Do not call the module done until every line in **Acceptance criteria** passes and the **QA checklist** has been run on a phone-width screen.
5. Update the repo-root `README.md` for anything that changed (routes, API, schema).

## Modules and build order

| # | Doc | Depends on | Size | Migration |
|---|---|---|:-:|---|
| 00 | [Conventions](00-conventions.md) | — | — | — |
| 01 | [Framework](01-framework.md) — shell, login, register, shared components | — | M | — |
| 02 | [Auth & security](02-auth-security.md) — PINs, throttling, sessions, audit log | 01 | L | 023, 024 |
| 03 | [Registration & members](03-registration-members.md) | 01, 02 | L | 025, 026 |
| 04 | [Masses & attendance](04-masses-attendance.md) | 03 | L | 027 |
| 05 | [Appeals](05-appeals.md) | 04 | M | 028 |
| 06 | [Reports](06-reports.md) - generate, approve, archive, export | 04, 05 | L | 029 |
| 07 | [Liturgy](07-liturgy.md) | 03, 04 | M | 030 |
| 08 | [Announcements & notifications](08-announcements-notifications.md) | 02 | M | 031 |
| 09 | [Payments](09-payments.md) | 03 | M | 032 |
| 10 | [Dashboards & insights](10-dashboards-insights.md) | 04-09 | M | 033 |
| 11 | [Settings & system](11-settings-system.md) | 02 | S | 034 |

Size is relative effort: S small, M medium, L large.

Module 02 comes early on purpose. Every later module writes to the audit log, so the `logAudit()` helper has to exist first.

## Roadmap

| Phase | Modules | Outcome |
|---|---|---|
| A. Foundation | 01, 02 | New shell and login. Safe PINs. Audit trail exists. |
| B. Core operations | 03, 04, 05 | People and attendance work end to end with the new UX. |
| C. Deliverable | 06 | Monthly report with preview, reasons, exports, storage. |
| D. Coordination | 07, 08, 09 | Liturgy, announcements, notifications, dues. |
| E. Insight and polish | 10, 11 | Dashboards, settings, health checks, backup. |

Each phase leaves the app fully working. Old pages are replaced as their module is rebuilt, never all at once.

## Product principles (unchanged from the current system)

1. Mobile-first: most use is on a phone, right after Mass.
2. Shared-device friendly: one PIN per role, fast login.
3. Data safety over speed: reports lock attendance, archives are append-only, destructive actions are guarded.
4. Accountability: reports pass through an independent approver.
5. Low-bandwidth tolerant: small payloads, server-rendered lists.

New for the revamp:

6. Everything that changes data leaves an audit entry.
7. Every screen has loading, empty and error states.
8. Rules live in pure functions with unit tests, not inside route handlers.

## Decision log

These are proposals. Confirm each before the module that needs it starts.

| ID | Decision | Recommendation | Needed by |
|---|---|---|---|
| D-1 | How do members identify themselves? Role PINs are shared, so today "a member" is anonymous. | Add an optional, self-declared "I am…" step (pick your name). Treat it as a convenience, not security. Never gate sensitive data on it alone. | 02 |
| D-2 | Keep resolved appeals as history instead of deleting them? | Yes, keep 12 months. This reverses a current design choice. | 05 |
| D-3 | Client data layer. | Adopt TanStack Query for interactive screens (attendance, appeals, payments). Keep server components for first load. | 01 |
| D-4 | Move report PDFs from base64-in-database to Supabase Storage. | Yes, as the last task of module 06. Old rows stay readable. | 06 |
| D-5 | Keep rejected reports as history instead of deleting them at regenerate. | Yes. Replace the unique month index with a partial index. | 06 |
| D-6 | Block attendance encoding for future-dated sessions. | Yes. It is a new rule. | 04 |
| D-7 | Confirm the installment proration formula used by payments today. | **Resolved.** There was none: the deadline column was decorative and the balance formula was duplicated four times. `balance()` is the extracted-and-pinned original; `amountDueByDate()` is new behaviour, anchored on the month bucketing the PDF already used. See module 09 section 4. | 09 |
| D-8 | Public source for the batch dropdown on `/register`. | Confirm which endpoint the page uses today. If none is public, add `GET /api/public/batches`. | 01 |
| D-9 | Who may see payment balances? | **Resolved as recommended.** Treasurer and admin see all. Everyone else sees structure names and a paid-up flag with no amount, plus their own figures. Enforced in the API, not the UI. | 09 |

## Glossary

- **Session**: one Mass on one date (`attendance_sessions`).
- **Roster**: the set of members marked present for a session.
- **Appeal**: a member's request to be added to a roster after the fact.
- **Report month**: the calendar month a monthly report covers.
- **Lock**: once a non-rejected report exists for a month, attendance for that month is read-only.
- **Church time**: the IANA timezone in `report_timezone` (default `Asia/Manila`). All schedule math uses it.
